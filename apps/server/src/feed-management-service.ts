import { randomBytes } from "node:crypto";
import type {
  FeedFolderRepository,
  FeedFolderRow,
  FeedRepository,
  FeedRow
} from "@dibao/db";
import type { ArticleRankingRecalculator } from "./ranking-service.js";

export const SOURCE_WEIGHT_MIN = -1;
export const SOURCE_WEIGHT_MAX = 1;

export class FeedManagementServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "FeedManagementServiceError";
  }
}

export type FeedManagementServiceOptions = {
  feeds: FeedRepository;
  folders: FeedFolderRepository;
  ranking?: ArticleRankingRecalculator;
  now?: () => number;
};

export class FeedManagementService {
  private readonly now: () => number;

  constructor(private readonly options: FeedManagementServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  createFolder(body: unknown): FeedFolderRow {
    const input = readObjectBody(body);
    const title = parseTitle(input.title, "title");
    const sortOrder =
      input.sortOrder === undefined
        ? this.options.folders.nextSortOrder()
        : parseSortOrder(input.sortOrder);
    const now = this.now();

    return this.options.folders.upsert({
      id: this.createFolderId(),
      title,
      sortOrder,
      now
    });
  }

  updateFolder(id: string, body: unknown): FeedFolderRow {
    const input = readObjectBody(body);
    const title = input.title === undefined ? undefined : parseTitle(input.title, "title");
    const sortOrder =
      input.sortOrder === undefined ? undefined : parseSortOrder(input.sortOrder);
    const updated = this.options.folders.update({
      id,
      ...(title !== undefined ? { title } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      now: this.now()
    });

    if (!updated) {
      throw notFound("Folder not found");
    }

    return updated;
  }

  deleteFolder(id: string): { ok: true } {
    const now = this.now();
    if (!this.options.folders.findById(id)) {
      throw notFound("Folder not found");
    }

    this.options.feeds.clearFolder(id, now);
    if (!this.options.folders.softDelete(id, now)) {
      throw notFound("Folder not found");
    }

    return { ok: true };
  }

  updateFeed(id: string, body: unknown): FeedRow {
    const existing = this.options.feeds.findById(id);
    if (!existing) {
      throw notFound("Feed not found");
    }

    const input = readObjectBody(body);
    const title = input.title === undefined ? undefined : parseTitle(input.title, "title");
    const folderId = input.folderId === undefined ? undefined : parseFolderId(input.folderId);
    const enabled = input.enabled === undefined ? undefined : parseBoolean(input.enabled, "enabled");
    const sourceWeight =
      input.sourceWeight === undefined ? undefined : parseSourceWeight(input.sourceWeight);

    this.validateFolderReference(folderId);

    const updated = this.options.feeds.update({
      id,
      ...(title !== undefined ? { title } : {}),
      ...(folderId !== undefined ? { folderId } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(sourceWeight !== undefined ? { sourceWeight } : {}),
      now: this.now()
    });

    if (!updated) {
      throw notFound("Feed not found");
    }

    if (sourceWeight !== undefined && sourceWeight !== existing.sourceWeight) {
      this.options.ranking?.recalculateAll();
    }

    return updated;
  }

  deleteFeed(id: string): { ok: true } {
    if (!this.options.feeds.softDelete(id, this.now())) {
      throw notFound("Feed not found");
    }

    return { ok: true };
  }

  validateFolderReference(folderId: string | null | undefined): void {
    if (folderId && !this.options.folders.findById(folderId)) {
      throw notFound("Folder not found");
    }
  }

  private createFolderId(): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = `folder_${randomBytes(10).toString("hex")}`;
      if (!this.options.folders.findById(id)) {
        return id;
      }
    }

    throw new Error("Unable to create unique folder id");
  }
}

function readObjectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("request body must be an object");
  }

  return value as Record<string, unknown>;
}

function parseTitle(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw validationError(`${field} must be a string`, { field });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw validationError(`${field} is required`, { field });
  }

  return trimmed;
}

function parseFolderId(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw validationError("folderId must be a string or null", { field: "folderId" });
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw validationError("folderId must be a string or null", { field: "folderId" });
  }

  return trimmed;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw validationError(`${field} must be a boolean`, { field });
  }

  return value;
}

function parseSortOrder(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw validationError("sortOrder must be an integer", { field: "sortOrder" });
  }

  return value;
}

function parseSourceWeight(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < SOURCE_WEIGHT_MIN ||
    value > SOURCE_WEIGHT_MAX
  ) {
    throw validationError("sourceWeight must be a number between -1 and 1", {
      field: "sourceWeight",
      min: SOURCE_WEIGHT_MIN,
      max: SOURCE_WEIGHT_MAX
    });
  }

  return value;
}

function validationError(message: string, details?: unknown): FeedManagementServiceError {
  return new FeedManagementServiceError(400, "VALIDATION_ERROR", message, details);
}

function notFound(message: string): FeedManagementServiceError {
  return new FeedManagementServiceError(404, "NOT_FOUND", message);
}
