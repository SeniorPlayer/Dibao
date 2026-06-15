export type ParsedFeedItem = {
  title: string;
  url: string;
  guid: string | null;
  author: string | null;
  summary: string | null;
  publishedAt: number | null;
  contentHtml: string | null;
  contentText: string | null;
};

export type ParsedFeed = {
  title: string;
  siteUrl: string | null;
  description: string | null;
  items: ParsedFeedItem[];
};

export type OpmlFeed = {
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  folderTitle: string | null;
};

export type ParsedOpml = {
  title: string | null;
  folders: string[];
  feeds: OpmlFeed[];
};

export type GenerateOpmlInput = {
  title: string;
  folders: Array<{
    title: string;
    feeds: Array<{
      title: string;
      feedUrl: string;
      siteUrl?: string | null;
    }>;
  }>;
  feeds: Array<{
    title: string;
    feedUrl: string;
    siteUrl?: string | null;
  }>;
};

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  textParts: string[];
};

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

export class OpmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpmlParseError";
  }
}

export function normalizeFeedUrl(input: string) {
  const url = new URL(input.trim());
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

export function parseFeedXml(xml: string, feedUrl: string): ParsedFeed {
  const root = parseXml(xml);
  if (!root) {
    throw new FeedParseError("Feed XML is empty");
  }

  const rootName = localName(root.name);
  if (rootName === "rss" || rootName === "rdf") {
    return parseRssFeed(root, feedUrl);
  }

  if (rootName === "feed") {
    return parseAtomFeed(root, feedUrl);
  }

  throw new FeedParseError(`Unsupported feed root: ${root.name}`);
}

export function parseOpml(xml: string): ParsedOpml {
  const root = parseXml(xml);
  if (!root) {
    throw new OpmlParseError("OPML XML is empty");
  }

  if (localName(root.name) !== "opml") {
    throw new OpmlParseError(`Unsupported OPML root: ${root.name}`);
  }

  const body = findChild(root, "body");
  if (!body) {
    throw new OpmlParseError("OPML is missing body");
  }

  const title = findChild(root, "head") ? childText(findChild(root, "head")!, "title") : null;
  const folders: string[] = [];
  const feeds: OpmlFeed[] = [];

  for (const outline of findChildren(body, "outline")) {
    collectOpmlOutline(outline, null, folders, feeds);
  }

  return {
    title,
    folders: dedupeStrings(folders),
    feeds
  };
}

export function generateOpml(input: GenerateOpmlInput): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeXml(input.title)}</title>`,
    "  </head>",
    "  <body>"
  ];

  for (const folder of input.folders) {
    lines.push(
      `    <outline text="${escapeXml(folder.title)}" title="${escapeXml(folder.title)}">`
    );
    for (const feed of inputFolderFeeds(folder.feeds)) {
      lines.push(`      ${opmlFeedOutline(feed)}`);
    }
    lines.push("    </outline>");
  }

  for (const feed of inputFolderFeeds(input.feeds)) {
    lines.push(`    ${opmlFeedOutline(feed)}`);
  }

  lines.push("  </body>", "</opml>");
  return `${lines.join("\n")}\n`;
}

function parseRssFeed(root: XmlNode, feedUrl: string): ParsedFeed {
  const channel = findChild(root, "channel");
  if (!channel) {
    throw new FeedParseError("RSS feed is missing channel");
  }

  const title = childText(channel, "title") ?? hostnameTitle(feedUrl);
  const siteUrl = normalizeMaybeUrl(childText(channel, "link"), feedUrl);
  const description = childText(channel, "description");

  return {
    title,
    siteUrl,
    description,
    items: findChildren(channel, "item").map((item, index) => parseRssItem(item, feedUrl, index))
  };
}

function parseRssItem(item: XmlNode, feedUrl: string, index: number): ParsedFeedItem {
  const guid = childText(item, "guid") ?? childText(item, "id");
  const title = childText(item, "title") ?? guid ?? `Untitled item ${index + 1}`;
  const url =
    normalizeMaybeUrl(childText(item, "link"), feedUrl) ??
    normalizeMaybeUrl(guid, feedUrl, false) ??
    fallbackItemUrl(feedUrl, title, guid, index);
  const summary = childText(item, "description");
  const contentHtml = childText(item, "content:encoded", "encoded", "content") ?? summary;

  return {
    title,
    url,
    guid,
    author: childText(item, "author", "dc:creator", "creator"),
    summary,
    publishedAt: parseDate(childText(item, "pubDate", "published", "updated", "dc:date", "date")),
    contentHtml,
    contentText: htmlToText(contentHtml ?? summary)
  };
}

function parseAtomFeed(root: XmlNode, feedUrl: string): ParsedFeed {
  const title = childText(root, "title") ?? hostnameTitle(feedUrl);
  const siteUrl = atomLink(root, feedUrl);
  const description = childText(root, "subtitle");

  return {
    title,
    siteUrl,
    description,
    items: findChildren(root, "entry").map((entry, index) => parseAtomEntry(entry, feedUrl, index))
  };
}

function parseAtomEntry(entry: XmlNode, feedUrl: string, index: number): ParsedFeedItem {
  const guid = childText(entry, "id");
  const title = childText(entry, "title") ?? guid ?? `Untitled entry ${index + 1}`;
  const url =
    atomLink(entry, feedUrl) ??
    normalizeMaybeUrl(guid, feedUrl, false) ??
    fallbackItemUrl(feedUrl, title, guid, index);
  const summary = childText(entry, "summary");
  const contentHtml = childText(entry, "content") ?? summary;
  const author = findChild(entry, "author");

  return {
    title,
    url,
    guid,
    author: author ? childText(author, "name") ?? nodeText(author) : null,
    summary,
    publishedAt: parseDate(childText(entry, "published", "updated")),
    contentHtml,
    contentText: htmlToText(contentHtml ?? summary)
  };
}

function collectOpmlOutline(
  outline: XmlNode,
  parentFolderTitle: string | null,
  folders: string[],
  feeds: OpmlFeed[]
): void {
  const feedUrl = cleanText(outline.attributes.xmlUrl ?? outline.attributes.xmlurl);
  if (feedUrl) {
    const title =
      cleanText(outline.attributes.title) ??
      cleanText(outline.attributes.text) ??
      cleanText(nodeText(outline)) ??
      feedUrl;

    feeds.push({
      title,
      feedUrl,
      siteUrl: cleanText(outline.attributes.htmlUrl ?? outline.attributes.htmlurl),
      folderTitle: parentFolderTitle
    });
    return;
  }

  const folderTitle =
    cleanText(outline.attributes.title) ??
    cleanText(outline.attributes.text) ??
    cleanText(nodeText(outline));
  const nextFolderTitle = folderTitle ?? parentFolderTitle;

  if (folderTitle) {
    folders.push(folderTitle);
  }

  for (const child of findChildren(outline, "outline")) {
    collectOpmlOutline(child, nextFolderTitle, folders, feeds);
  }
}

function parseXml(xml: string): XmlNode | null {
  const document: XmlNode = {
    name: "#document",
    attributes: {},
    children: [],
    textParts: []
  };
  const stack: XmlNode[] = [document];
  const tokenPattern =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/?[^>]+>|[^<]+/gi;

  for (const match of xml.matchAll(tokenPattern)) {
    const token = match[0];
    const current = stack[stack.length - 1];

    if (token.startsWith("<!--") || token.startsWith("<?") || /^<!DOCTYPE/i.test(token)) {
      continue;
    }

    if (token.startsWith("<![CDATA[")) {
      current.textParts.push(token.slice(9, -3));
      continue;
    }

    if (token.startsWith("</")) {
      const name = readTagName(token);
      while (stack.length > 1) {
        const node = stack.pop();
        if (node && sameXmlName(node.name, name)) {
          break;
        }
      }
      continue;
    }

    if (token.startsWith("<")) {
      const name = readTagName(token);
      if (!name) {
        continue;
      }

      const node: XmlNode = {
        name,
        attributes: readAttributes(token),
        children: [],
        textParts: []
      };
      current.children.push(node);

      if (!token.endsWith("/>")) {
        stack.push(node);
      }
      continue;
    }

    current.textParts.push(decodeXmlEntities(token));
  }

  return document.children[0] ?? null;
}

function inputFolderFeeds(feeds: GenerateOpmlInput["feeds"]): GenerateOpmlInput["feeds"] {
  return [...feeds].sort((left, right) =>
    left.title.localeCompare(right.title, "en", { sensitivity: "base" })
  );
}

function opmlFeedOutline(feed: GenerateOpmlInput["feeds"][number]): string {
  const attributes = [
    `text="${escapeXml(feed.title)}"`,
    `title="${escapeXml(feed.title)}"`,
    'type="rss"',
    `xmlUrl="${escapeXml(feed.feedUrl)}"`
  ];

  if (feed.siteUrl) {
    attributes.push(`htmlUrl="${escapeXml(feed.siteUrl)}"`);
  }

  return `<outline ${attributes.join(" ")} />`;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "\"":
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });
}

function readTagName(tag: string): string {
  return tag.match(/^<\/?\s*([^\s/>]+)/)?.[1] ?? "";
}

function readAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrPattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

  for (const match of tag.matchAll(attrPattern)) {
    attributes[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function findChild(node: XmlNode, ...names: string[]): XmlNode | null {
  return node.children.find((child) => names.some((name) => sameXmlName(child.name, name))) ?? null;
}

function findChildren(node: XmlNode, ...names: string[]): XmlNode[] {
  return node.children.filter((child) => names.some((name) => sameXmlName(child.name, name)));
}

function childText(node: XmlNode, ...names: string[]): string | null {
  for (const name of names) {
    const child = findChild(node, name);
    const text = child ? nodeText(child) : null;
    if (text) {
      return text;
    }
  }

  return null;
}

function atomLink(node: XmlNode, feedUrl: string): string | null {
  const links = findChildren(node, "link");
  const preferred =
    links.find((link) => {
      const rel = link.attributes.rel;
      return rel === undefined || rel === "" || rel === "alternate";
    }) ?? links[0];

  if (!preferred) {
    return null;
  }

  return normalizeMaybeUrl(preferred.attributes.href ?? nodeText(preferred), feedUrl);
}

function nodeText(node: XmlNode): string {
  const text = [
    ...node.textParts,
    ...node.children.map((child) => nodeText(child))
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function sameXmlName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase() || localName(left) === right.toLowerCase();
}

function localName(name: string): string {
  return name.toLowerCase().split(":").pop() ?? name.toLowerCase();
}

function normalizeMaybeUrl(
  value: string | null | undefined,
  baseUrl: string,
  allowRelative = true
): string | null {
  if (!value) {
    return null;
  }

  try {
    const trimmed = value.trim();
    if (!allowRelative && !/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
      return null;
    }
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function fallbackItemUrl(feedUrl: string, title: string, guid: string | null, index: number): string {
  const url = new URL(feedUrl);
  url.hash = `item-${hashText(`${title}|${guid ?? ""}|${index}`)}`;
  return url.toString();
}

function hostnameTitle(feedUrl: string): string {
  return new URL(feedUrl).hostname;
}

function parseDate(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function htmlToText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const text = decodeXmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos") return "'";
    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }
    return `&${entity};`;
  });
}

function hashText(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}
