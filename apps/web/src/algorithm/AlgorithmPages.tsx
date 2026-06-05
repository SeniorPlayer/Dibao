import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type { ClusterLabelLexiconOverrides, ClusterLabelLexiconResponse, RecommendationClusterItem, RecommendationClusterMergeCandidate, RecommendationFamilySummaryItem, RecommendationMaintenanceTask, RecommendationStatus, RecommendationTransparency } from "../api.js";
import { useI18n } from "../i18n.js";
import styles from "../design-system/AppShell/AppShell.module.css";
import { algorithmStatusClassName, classNames, clusterDisplayName, confidenceBucket, formatCompactNumber, formatMaintenanceSchedule, formatMaintenanceTaskSchedule, formatPercent, maintenanceTasks, shouldLetBrowserHandleLinkClick, urlForAppPage } from "../app/shared.js";

export function AlgorithmTransparencyPage(props: {
  clusterLabelLexicon: ClusterLabelLexiconResponse | null;
  error: string | null;
  isLoading: boolean;
  mergeCandidates: RecommendationClusterMergeCandidate[];
  onBack: () => void;
  onIgnoreCandidate: (candidateId: string) => Promise<void>;
  onMergeCandidate: (candidateId: string) => Promise<void>;
  onOpenAllClusters: () => void;
  onRunMaintenanceTask: (task: RecommendationMaintenanceTask, label: string) => Promise<void>;
  onUpdateClusterLabelLexicon: (
    overrides: Partial<ClusterLabelLexiconOverrides>
  ) => Promise<void>;
  onUpdateClusterLabel: (clusterId: string, manualLabel: string | null) => Promise<void>;
  onUpdateFamilyLabel: (familyId: string, manualLabel: string | null) => Promise<void>;
  runningMaintenanceTask: RecommendationMaintenanceTask | null;
  status: RecommendationStatus | null;
  updatingClusterLexicon: boolean;
  updatingClusterLabelId: string | null;
  updatingFamilyLabelId: string | null;
  updatingMergeCandidateId: string | null;
}) {
  const { t, formatDate } = useI18n();
  const transparency =
    props.status && "transparency" in props.status
      ? (props.status as RecommendationTransparency).transparency
      : null;
  const statusText = props.error
    ? t.recommendationStatus.fallback
    : props.status
      ? t.recommendationStatus.modes[props.status.mode]
      : props.isLoading
        ? t.recommendationStatus.loading
        : t.recommendationStatus.fallback;
  const behaviorEntries = props.status ? Object.entries(props.status.behaviorCounts) : [];
  const clusterItems = props.status?.clusters.items ?? [];
  const clusterTotal = props.status
    ? props.status.clusters.positive + props.status.clusters.negative
    : 0;
  const recommendationStatusRows: Array<{ label: string; value: string }> = props.status
    ? [
        {
          label: t.algorithmTransparency.fields.provider,
          value: props.status.activeProvider
            ? `${props.status.activeProvider.name} · ${props.status.activeProvider.model}`
            : t.settings.sections.provider.disabled
        },
        {
          label: t.algorithmTransparency.fields.index,
          value: props.status.activeIndex
            ? `${props.status.activeIndex.model} · ${props.status.activeIndex.status}`
            : t.settings.sections.provider.coverageUnavailable
        },
        {
          label: t.algorithmTransparency.fields.coverage,
          value: t.settings.sections.provider.coverage(
            props.status.coverage.coveredArticleCount ?? props.status.coverage.embeddingCount,
            props.status.coverage.candidateCount,
            formatPercent(props.status.coverage.coverageRatio)
          )
        },
        {
          label: t.algorithmTransparency.fields.behaviorCounts,
          value:
            behaviorEntries.length > 0
              ? behaviorEntries.map(([name, count]) => `${name}: ${count}`).join(" · ")
              : t.recommendationStatus.metrics.unknown
        },
        {
          label: t.algorithmTransparency.fields.clusters,
          value: t.recommendationStatus.metrics.clusters(
            props.status.clusters.positive,
            props.status.clusters.negative
          )
        },
        {
          label: t.algorithmTransparency.fields.lastUpdates,
          value: t.recommendationStatus.metrics.lastUpdate(
            props.status.lastRankingUpdate
              ? formatDate(props.status.lastRankingUpdate)
              : t.recommendationStatus.metrics.unknown,
            props.status.lastProfileUpdate
              ? formatDate(props.status.lastProfileUpdate)
              : t.recommendationStatus.metrics.unknown
          )
        },
        {
          label: t.algorithmTransparency.fields.warnings,
          value:
            props.status.warnings.length > 0
              ? props.status.warnings
                  .map((warning) => `${warning.code}: ${warning.message}`)
                  .join(" · ")
              : t.algorithmTransparency.noWarnings
        },
        ...(props.status.algorithm
          ? [
              {
                label: t.algorithmTransparency.fields.cocoon,
                value: `${props.status.algorithm.cocoonLevel} · MMR λ ${
                  props.status.algorithm.cocoonParameters.mmrLambda
                } · ${t.algorithmTransparency.fields.exploration}: ${
                  props.status.algorithm.exploration.enabled
                    ? t.settings.sections.retention.enabled
                    : t.settings.sections.retention.disabled
                }`
              }
            ]
          : []),
        ...(transparency
          ? [
              {
                label: t.algorithmTransparency.fields.formula,
                value: transparency.currentFormula
              },
              ...(transparency.maintenance
                ? [
                    {
                      label: t.algorithmTransparency.fields.automaticMaintenance,
                      value: formatMaintenanceSchedule(transparency.maintenance)
                    }
                  ]
                : []),
              {
                label: t.algorithmTransparency.fields.failureStates,
                value:
                  Object.entries(transparency.failureStates)
                    .filter(([, active]) => active)
                    .map(([name]) => name)
                    .join(" · ") || t.algorithmTransparency.noWarnings
              }
            ]
          : [])
      ]
    : [];

  return (
    <section
      className={classNames(styles.settingsWorkspace, "algorithm-board-page")}
      aria-label={t.algorithmTransparency.pageTitle}
    >
      <div className={classNames(styles.settingsHeader, "algorithm-hero")}>
        <button className={styles.secondaryButton} onClick={props.onBack} type="button">
          {t.algorithmTransparency.backToSettings}
        </button>
      </div>

      <div className={classNames(styles.settingsContent, "algorithm-board")}>
        {props.isLoading ? (
          <p className={styles.settingsNotice}>{t.recommendationStatus.loading}</p>
        ) : null}
        {props.error ? <p className={styles.errorText}>{props.error}</p> : null}

        <section className={classNames(styles.settingsSection, "algorithm-card", "diagnostics-card")}>
          <div>
            <h3>{t.algorithmTransparency.sections.currentStatus}</h3>
            <p>{statusText}</p>
          </div>
          {recommendationStatusRows.length > 0 ? (
            <div className={styles.algorithmStatusTableWrap}>
              <table className={styles.algorithmStatusTable}>
                <tbody>
                  {recommendationStatusRows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {transparency?.algorithmModules ? (
            <div className={styles.algorithmStatusTableWrap}>
              <table className={styles.algorithmStatusTable}>
                <thead>
                  <tr>
                    <th>{t.algorithmTransparency.statusTable.module}</th>
                    <th>{t.algorithmTransparency.statusTable.status}</th>
                    <th>{t.algorithmTransparency.statusTable.summary}</th>
                  </tr>
                </thead>
                <tbody>
                  {transparency.algorithmModules.map((module) => (
                    <tr key={module.id}>
                      <th scope="row">{module.name}</th>
                      <td>
                        <span className={algorithmStatusClassName(module.status)}>
                          {t.algorithmTransparency.statusTones[module.status]}
                        </span>
                      </td>
                      <td>{module.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <FamilySummaryPanel
          families={props.status?.clusters.families ?? null}
          onUpdateFamilyLabel={props.onUpdateFamilyLabel}
          updatingFamilyLabelId={props.updatingFamilyLabelId}
        />

        <section className={classNames(styles.settingsSection, "algorithm-card")}>
          <div>
            <h3>{t.algorithmTransparency.sections.currentClusters}</h3>
            <p>{t.algorithmTransparency.clusters.generated}</p>
          </div>
          {clusterItems.length > 0 ? (
            <div className={styles.algorithmClusterGrid}>
              {clusterItems.map((cluster, index) => (
                <ClusterCard
                  cluster={cluster}
                  index={index}
                  key={cluster.id}
                  onUpdateLabel={props.onUpdateClusterLabel}
                  updating={props.updatingClusterLabelId === cluster.id}
                />
              ))}
            </div>
          ) : clusterTotal === 0 ? (
            <p>{t.algorithmTransparency.clusters.empty}</p>
          ) : null}
          {clusterTotal > 0 ? (
            <a
              className={styles.textLink}
              href={urlForAppPage({ type: "algorithm-clusters" })}
              onClick={(event) => {
                if (shouldLetBrowserHandleLinkClick(event)) {
                  return;
                }
                event.preventDefault();
                props.onOpenAllClusters();
              }}
            >
              {t.algorithmTransparency.clusters.openAll}
            </a>
          ) : null}
        </section>

        <ClusterMergeCandidatesPanel
          candidates={props.mergeCandidates}
          onIgnoreCandidate={props.onIgnoreCandidate}
          onMergeCandidate={props.onMergeCandidate}
          updatingCandidateId={props.updatingMergeCandidateId}
        />

        <ClusterLabelLexiconPanel
          lexicon={props.clusterLabelLexicon}
          onSave={props.onUpdateClusterLabelLexicon}
          saving={props.updatingClusterLexicon}
        />

        <section className={classNames(styles.settingsSection, "algorithm-card")}>
          <div>
            <h3>{t.algorithmTransparency.sections.terms}</h3>
          </div>
          <dl className={styles.algorithmTermList}>
            {t.algorithmTransparency.terms.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={classNames(styles.settingsSection, "algorithm-card")}>
          <div>
            <h3>{t.algorithmTransparency.sections.algorithmExplanation}</h3>
          </div>
          <div className={styles.algorithmExplanationList}>
            {t.algorithmTransparency.algorithmExplanation.map((item) => (
              <article key={item.name}>
                <strong>{item.name}</strong>
                <p>{item.role}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={classNames(styles.settingsSection, "algorithm-card")}>
          <div>
            <h3>{t.algorithmTransparency.sections.scoreTable}</h3>
          </div>
          <div className={styles.algorithmScoreTableWrap}>
            <table className={styles.algorithmScoreTable}>
              <thead>
                <tr>
                  <th>{t.algorithmTransparency.scoreTable.columns.behavior}</th>
                  <th>{t.algorithmTransparency.scoreTable.columns.modelCard}</th>
                  <th>{t.algorithmTransparency.scoreTable.columns.source}</th>
                  <th>{t.algorithmTransparency.scoreTable.columns.ranking}</th>
                  <th>{t.algorithmTransparency.scoreTable.columns.notes}</th>
                </tr>
              </thead>
              <tbody>
                {t.algorithmTransparency.scoreTable.rows.map((row) => (
                  <tr key={row.behavior}>
                    <th scope="row">{row.behavior}</th>
                    <td>{row.modelCard}</td>
                    <td>{row.source}</td>
                    <td>{row.ranking}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={classNames(styles.settingsSection, "algorithm-card")}>
          <div>
            <h3>{t.algorithmTransparency.sections.channelRules}</h3>
          </div>
          <ul className={styles.algorithmBulletList}>
            {t.algorithmTransparency.channelRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>

        <section className={classNames(styles.settingsSection, "algorithm-card")}>
          <div>
            <h3>{t.algorithmTransparency.sections.dataAndFallback}</h3>
          </div>
          <p>{t.algorithmTransparency.copy.localData}</p>
          <p>{t.algorithmTransparency.copy.fallback}</p>
        </section>

        {transparency ? (
          <section className={classNames(styles.settingsSection, "algorithm-card")}>
            <details className={styles.maintenanceDisclosure}>
              <summary>
                <span className={styles.maintenanceSummaryText}>
                  <span className={styles.maintenanceSummaryTitle}>
                    {t.algorithmTransparency.sections.maintenance}
                  </span>
                  <span>{t.algorithmTransparency.maintenance.disclosureHint}</span>
                </span>
              </summary>
              <p className={styles.settingsNotice}>{t.algorithmTransparency.maintenance.body}</p>
              <div className={styles.maintenanceTaskList}>
                {maintenanceTasks(t).map((task) => {
                  const schedule = transparency.maintenance.schedule?.find(
                    (state) => state.taskKey === task.scheduleKey
                  );
                  return (
                    <div className={styles.maintenanceTaskRow} key={task.key}>
                      <div className={styles.maintenanceTaskMain}>
                        <strong>{task.label}</strong>
                        <p>{task.description}</p>
                      </div>
                      <dl className={styles.maintenanceTaskMeta}>
                        <div>
                          <dt>{t.algorithmTransparency.maintenance.remoteUse}</dt>
                          <dd>{task.remoteUse}</dd>
                        </div>
                        <div>
                          <dt>{t.algorithmTransparency.maintenance.lastState}</dt>
                          <dd>{formatMaintenanceTaskSchedule(schedule, t)}</dd>
                        </div>
                      </dl>
                      <button
                        className={styles.secondaryButton}
                        disabled={props.runningMaintenanceTask === task.key}
                        onClick={() => void props.onRunMaintenanceTask(task.key, task.label)}
                        type="button"
                      >
                        {props.runningMaintenanceTask === task.key
                          ? t.algorithmTransparency.maintenance.running
                          : t.algorithmTransparency.maintenance.run}
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function ClusterMergeCandidatesPanel(props: {
  candidates: RecommendationClusterMergeCandidate[];
  onIgnoreCandidate: (candidateId: string) => Promise<void>;
  onMergeCandidate: (candidateId: string) => Promise<void>;
  updatingCandidateId: string | null;
}) {
  const { t } = useI18n();
  const visibleCandidates = props.candidates
    .filter((candidate) => candidate.status === "open")
    .slice(0, 8);

  return (
    <section className={classNames(styles.settingsSection, "algorithm-card")}>
      <div>
        <h3>{t.algorithmTransparency.mergeCandidates.title}</h3>
        <p>{t.algorithmTransparency.mergeCandidates.body}</p>
      </div>
      {visibleCandidates.length > 0 ? (
        <div className={styles.algorithmStatusTableWrap}>
          <table className={styles.algorithmStatusTable}>
            <thead>
              <tr>
                <th>{t.algorithmTransparency.mergeCandidates.left}</th>
                <th>{t.algorithmTransparency.mergeCandidates.right}</th>
                <th>{t.algorithmTransparency.mergeCandidates.metrics}</th>
                <th>{t.algorithmTransparency.mergeCandidates.recommendation}</th>
                <th>{t.algorithmTransparency.mergeCandidates.actions}</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td>{candidate.leftLabel}</td>
                  <td>{candidate.rightLabel}</td>
                  <td>
                    {t.algorithmTransparency.mergeCandidates.metricSummary(
                      formatPercent(candidate.centroidSimilarity),
                      formatPercent(candidate.labelJaccard),
                      formatPercent(candidate.evidenceOverlap),
                      formatPercent(candidate.mergeScore)
                    )}
                  </td>
                  <td>
                    {candidate.polarity} ·{" "}
                    {t.algorithmTransparency.mergeCandidates.recommendations[candidate.recommendation]}
                  </td>
                  <td>
                    <div className={styles.clusterLabelActions}>
                      <button
                        className={styles.secondaryButton}
                        disabled={props.updatingCandidateId === candidate.id}
                        onClick={() => void props.onMergeCandidate(candidate.id)}
                        type="button"
                      >
                        {t.algorithmTransparency.mergeCandidates.merge}
                      </button>
                      <button
                        className={styles.secondaryButton}
                        disabled={props.updatingCandidateId === candidate.id}
                        onClick={() => void props.onIgnoreCandidate(candidate.id)}
                        type="button"
                      >
                        {t.algorithmTransparency.mergeCandidates.ignore}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.settingsNotice}>{t.algorithmTransparency.mergeCandidates.empty}</p>
      )}
    </section>
  );
}

function ClusterLabelLexiconPanel(props: {
  lexicon: ClusterLabelLexiconResponse | null;
  onSave: (overrides: Partial<ClusterLabelLexiconOverrides>) => Promise<void>;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [draftStopword, setDraftStopword] = useState("");
  const [stopwordsAdd, setStopwordsAdd] = useState<string[]>([]);

  useEffect(() => {
    setStopwordsAdd(props.lexicon?.overrides.stopwordsAdd ?? []);
  }, [props.lexicon?.overrides.stopwordsAdd]);

  function addDraftStopword() {
    const next = draftStopword.trim();
    if (!next || stopwordsAdd.includes(next)) {
      setDraftStopword("");
      return;
    }
    setStopwordsAdd([...stopwordsAdd, next]);
    setDraftStopword("");
  }

  function removeStopword(term: string) {
    setStopwordsAdd(stopwordsAdd.filter((item) => item !== term));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await props.onSave({ stopwordsAdd });
  }

  return (
    <section className={classNames(styles.settingsSection, "algorithm-card")}>
      <div>
        <h3>{t.algorithmTransparency.lexicon.title}</h3>
        <p>{t.algorithmTransparency.lexicon.body}</p>
      </div>
      {props.lexicon?.warnings.length ? (
        <p className={styles.errorText}>{props.lexicon.warnings.join(" / ")}</p>
      ) : null}
      <form className={styles.clusterLabelForm} onSubmit={handleSubmit}>
        <label>
          {t.algorithmTransparency.lexicon.stopwordsAdd}
          <input
            maxLength={64}
            onChange={(event) => setDraftStopword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDraftStopword();
              }
            }}
            placeholder={t.algorithmTransparency.lexicon.stopwordPlaceholder}
            value={draftStopword}
          />
        </label>
        <div className={styles.clusterLabelActions}>
          <button className={styles.secondaryButton} onClick={addDraftStopword} type="button">
            {t.algorithmTransparency.lexicon.addStopword}
          </button>
          <button className={styles.primaryButton} disabled={props.saving} type="submit">
            {props.saving
              ? t.algorithmTransparency.maintenance.running
              : t.algorithmTransparency.lexicon.saveAndRebuild}
          </button>
        </div>
      </form>
      {stopwordsAdd.length > 0 ? (
        <div className={styles.clusterLabelActions}>
          {stopwordsAdd.map((term) => (
            <button
              className={styles.secondaryButton}
              key={term}
              onClick={() => removeStopword(term)}
              type="button"
            >
              {term} ×
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.settingsNotice}>{t.algorithmTransparency.lexicon.noStopwords}</p>
      )}
      {props.lexicon?.overrides.protectedTermsAdd.length ? (
        <p>
          <strong>{t.algorithmTransparency.lexicon.protectedTermsAdd}</strong>
          <br />
          {props.lexicon.overrides.protectedTermsAdd.join(" / ")}
        </p>
      ) : null}
    </section>
  );
}

function FamilySummaryPanel(props: {
  families: RecommendationStatus["clusters"]["families"] | null;
  onUpdateFamilyLabel: (familyId: string, manualLabel: string | null) => Promise<void>;
  updatingFamilyLabelId: string | null;
}) {
  const { t } = useI18n();
  const families = props.families?.topFamilies ?? [];

  return (
    <section className={classNames(styles.settingsSection, "algorithm-card")}>
      <div>
        <h3>{t.algorithmTransparency.sections.topicFamilies}</h3>
        <p>
          {props.families
            ? t.algorithmTransparency.families.summary(
                props.families.positive,
                props.families.negative,
                t.algorithmTransparency.families.risk[props.families.concentrationRisk]
              )
            : t.algorithmTransparency.families.empty}
        </p>
      </div>
      {families.length > 0 ? (
        <div className={styles.algorithmFamilyList}>
          {families.slice(0, 6).map((family) => (
            <FamilySummaryRow
              family={family}
              key={family.id}
              onUpdateFamilyLabel={props.onUpdateFamilyLabel}
              updating={props.updatingFamilyLabelId === family.id}
            />
          ))}
        </div>
      ) : (
        <p>{t.algorithmTransparency.families.empty}</p>
      )}
    </section>
  );
}

function FamilySummaryRow(props: {
  family: RecommendationFamilySummaryItem;
  onUpdateFamilyLabel: (familyId: string, manualLabel: string | null) => Promise<void>;
  updating: boolean;
}) {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(
    props.family.manualLabel ?? props.family.displayLabel
  );

  useEffect(() => {
    if (!isEditing) {
      setDraftLabel(props.family.manualLabel ?? props.family.displayLabel);
    }
  }, [isEditing, props.family.displayLabel, props.family.manualLabel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await props.onUpdateFamilyLabel(props.family.id, draftLabel.trim() || null);
    setIsEditing(false);
  }

  async function handleClearManualLabel() {
    await props.onUpdateFamilyLabel(props.family.id, null);
    setIsEditing(false);
  }

  return (
    <div className={styles.algorithmFamilyRow}>
      <div>
        <strong>{props.family.displayLabel}</strong>
        <p>
          {t.algorithmTransparency.families.rowMeta(
            props.family.clusterCount,
            props.family.supportArticleCount,
            props.family.sourceCount,
            formatPercent(props.family.dominanceRatio),
            formatPercent(props.family.maturity)
          )}
        </p>
      </div>
      <span className={styles.algorithmFamilyPill}>
        {t.algorithmTransparency.families.risk[props.family.diagnostics.concentrationRisk]}
      </span>
      {isEditing ? (
        <form className={styles.clusterLabelForm} onSubmit={handleSubmit}>
          <label>
            {t.algorithmTransparency.families.renameLabel}
            <input
              maxLength={48}
              onChange={(event) => setDraftLabel(event.target.value)}
              placeholder={t.algorithmTransparency.families.renamePlaceholder}
              value={draftLabel}
            />
          </label>
          <div className={styles.clusterLabelActions}>
            <button className={styles.primaryButton} disabled={props.updating} type="submit">
              {t.algorithmTransparency.families.saveLabel}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={props.updating}
              onClick={() => setIsEditing(false)}
              type="button"
            >
              {t.algorithmTransparency.families.cancelRename}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.clusterLabelActions}>
          <button
            className={styles.secondaryButton}
            disabled={props.updating}
            onClick={() => setIsEditing(true)}
            type="button"
          >
            {t.algorithmTransparency.families.rename}
          </button>
          {props.family.manualLabel ? (
            <button
              className={styles.secondaryButton}
              disabled={props.updating}
              onClick={() => void handleClearManualLabel()}
              type="button"
            >
              {t.algorithmTransparency.families.clearManualLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function groupClustersByPolarityAndFamily(
  clusters: RecommendationClusterItem[],
  labels: {
    positive: string;
    negative: string;
    ungrouped: string;
  }
): Array<{
  polarity: "positive" | "negative";
  label: string;
  groups: Array<{
    id: string;
    label: string;
    family: NonNullable<RecommendationClusterItem["family"]> | null;
    clusters: RecommendationClusterItem[];
  }>;
}> {
  const groups = new Map<string, { id: string; label: string; clusters: RecommendationClusterItem[] }>();
  clusters.forEach((cluster, index) => {
    const id = cluster.family?.id ?? `ungrouped:${cluster.polarity}`;
    const label = cluster.family?.displayLabel ?? labels.ungrouped;
    const group = groups.get(id) ?? { id, label, clusters: [] };
    group.clusters.push({ ...cluster, displayIndex: cluster.displayIndex ?? index + 1 });
    groups.set(id, group);
  });
  const grouped = Array.from(groups.values()).map((group) => ({
    ...group,
    family: group.id.startsWith("ungrouped:") ? null : group.clusters[0]?.family ?? null
  }));
  const byPolarity = {
    positive: grouped
      .filter((group) => group.clusters.some((cluster) => cluster.polarity === "positive"))
      .sort(sortFamilyGroups),
    negative: grouped
      .filter((group) => group.clusters.some((cluster) => cluster.polarity === "negative"))
      .sort(sortFamilyGroups)
  };
  return [
    { polarity: "positive", label: labels.positive, groups: byPolarity.positive },
    { polarity: "negative", label: labels.negative, groups: byPolarity.negative }
  ];
}

function sortFamilyGroups(
  left: { label: string; clusters: RecommendationClusterItem[] },
  right: { label: string; clusters: RecommendationClusterItem[] }
) {
  return right.clusters.length - left.clusters.length || left.label.localeCompare(right.label);
}

export function AlgorithmClustersPage(props: {
  clusters: RecommendationClusterItem[];
  error: string | null;
  isLoading: boolean;
  onBack: () => void;
  onUpdateClusterLabel: (clusterId: string, manualLabel: string | null) => Promise<void>;
  onUpdateFamilyLabel: (familyId: string, manualLabel: string | null) => Promise<void>;
  total: number;
  updatingClusterLabelId: string | null;
  updatingFamilyLabelId: string | null;
}) {
  const { t } = useI18n();
  const polarityGroups = groupClustersByPolarityAndFamily(props.clusters, {
    positive: t.algorithmTransparency.clusters.positiveGroupTitle,
    negative: t.algorithmTransparency.clusters.negativeGroupTitle,
    ungrouped: t.algorithmTransparency.families.ungroupedFallback
  });

  return (
    <section
      className={classNames(styles.settingsWorkspace, "algorithm-board-page")}
      aria-labelledby="algorithm-clusters-title"
    >
      <div className={classNames(styles.settingsHeader, "algorithm-hero")}>
        <div>
          <p className={styles.kicker}>{t.algorithmTransparency.pageTitle}</p>
          <h2 id="algorithm-clusters-title">{t.algorithmTransparency.clusters.allTitle}</h2>
        </div>
        <button className={styles.secondaryButton} onClick={props.onBack} type="button">
          {t.algorithmTransparency.clusters.back}
        </button>
      </div>
      <div className={classNames(styles.settingsContent, "algorithm-board")}>
        <section className={classNames(styles.settingsSection, "algorithm-card")}>
          <div>
            <h3>{t.algorithmTransparency.clusters.allTitle}</h3>
            <p>{t.algorithmTransparency.clusters.allSummary(props.total)}</p>
          </div>
          {props.isLoading ? (
            <p className={styles.settingsNotice}>{t.recommendationStatus.loading}</p>
          ) : null}
          {props.error ? <p className={styles.errorText}>{props.error}</p> : null}
          {!props.isLoading && !props.error && props.clusters.length > 0 ? (
            <div className={styles.algorithmFamilyList}>
              {polarityGroups.map((polarityGroup) => (
                <section className={styles.algorithmPolarityGroup} key={polarityGroup.polarity}>
                  <h4>
                    {polarityGroup.label} ·{" "}
                    {t.algorithmTransparency.families.clusterCount(
                      polarityGroup.groups.reduce((sum, group) => sum + group.clusters.length, 0)
                    )}
                  </h4>
                  {polarityGroup.groups.map((group) => (
                    <section className={styles.algorithmFamilyGroup} key={group.id}>
                      <div className={styles.algorithmFamilyGroupHeader}>
                        <strong>
                          {group.label} · {t.algorithmTransparency.families.clusterCount(group.clusters.length)}
                        </strong>
                        {group.family ? (
                          <FamilyGroupRename
                            family={group.family}
                            onUpdateFamilyLabel={props.onUpdateFamilyLabel}
                            updating={props.updatingFamilyLabelId === group.id}
                          />
                        ) : null}
                      </div>
                      <div className={styles.algorithmClusterGrid}>
                        {group.clusters.map((cluster) => (
                          <ClusterCard
                            cluster={cluster}
                            index={cluster.displayIndex ?? props.clusters.indexOf(cluster) + 1}
                            key={cluster.id}
                            onUpdateLabel={props.onUpdateClusterLabel}
                            updating={props.updatingClusterLabelId === cluster.id}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </section>
              ))}
            </div>
          ) : null}
          {!props.isLoading && !props.error && props.clusters.length === 0 ? (
            <p>{t.algorithmTransparency.clusters.empty}</p>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function FamilyGroupRename(props: {
  family: NonNullable<RecommendationClusterItem["family"]> | null;
  onUpdateFamilyLabel: (familyId: string, manualLabel: string | null) => Promise<void>;
  updating: boolean;
}) {
  const { t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(
    props.family?.manualLabel ?? props.family?.displayLabel ?? ""
  );

  useEffect(() => {
    if (!isEditing) {
      setDraftLabel(props.family?.manualLabel ?? props.family?.displayLabel ?? "");
    }
  }, [isEditing, props.family?.displayLabel, props.family?.manualLabel]);

  if (!props.family) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.family) {
      return;
    }
    await props.onUpdateFamilyLabel(props.family.id, draftLabel.trim() || null);
    setIsEditing(false);
  }

  async function handleClearManualLabel() {
    if (!props.family) {
      return;
    }
    await props.onUpdateFamilyLabel(props.family.id, null);
    setIsEditing(false);
  }

  return isEditing ? (
    <form className={styles.clusterLabelForm} onSubmit={handleSubmit}>
      <label>
        {t.algorithmTransparency.families.renameLabel}
        <input
          maxLength={48}
          onChange={(event) => setDraftLabel(event.target.value)}
          placeholder={t.algorithmTransparency.families.renamePlaceholder}
          value={draftLabel}
        />
      </label>
      <div className={styles.clusterLabelActions}>
        <button className={styles.primaryButton} disabled={props.updating} type="submit">
          {t.algorithmTransparency.families.saveLabel}
        </button>
        <button
          className={styles.secondaryButton}
          disabled={props.updating}
          onClick={() => setIsEditing(false)}
          type="button"
        >
          {t.algorithmTransparency.families.cancelRename}
        </button>
      </div>
    </form>
  ) : (
    <div className={styles.algorithmFamilyActions}>
      <button
        className={styles.secondaryButton}
        disabled={props.updating}
        onClick={() => setIsEditing(true)}
        type="button"
      >
        {t.algorithmTransparency.families.rename}
      </button>
      {props.family.manualLabel ? (
        <button
          className={styles.secondaryButton}
          disabled={props.updating}
          onClick={() => void handleClearManualLabel()}
          type="button"
        >
          {t.algorithmTransparency.families.clearManualLabel}
        </button>
      ) : null}
    </div>
  );
}

function ClusterCard(props: {
  cluster: RecommendationClusterItem;
  index: number;
  onUpdateLabel: (clusterId: string, manualLabel: string | null) => Promise<void>;
  updating: boolean;
}) {
  const { t, formatDate } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(
    props.cluster.manualLabel ?? props.cluster.displayLabel ?? props.cluster.label ?? ""
  );
  const source = props.cluster.labelSource ?? "fallback";
  const confidence = props.cluster.confidence ?? 0;
  const evidenceCount =
    props.cluster.evidenceCount ?? props.cluster.diagnostics?.supportArticleCount ?? 0;
  const topTerms = props.cluster.topTerms ?? [];
  const representativeArticles = props.cluster.representativeArticles ?? [];
  const feedTitles = props.cluster.feedTitles ?? [];

  useEffect(() => {
    if (!isEditing) {
      setDraftLabel(
        props.cluster.manualLabel ?? props.cluster.displayLabel ?? props.cluster.label ?? ""
      );
    }
  }, [isEditing, props.cluster.displayLabel, props.cluster.label, props.cluster.manualLabel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await props.onUpdateLabel(props.cluster.id, draftLabel.trim() || null);
    setIsEditing(false);
  }

  async function handleClearManualLabel() {
    await props.onUpdateLabel(props.cluster.id, null);
    setIsEditing(false);
  }

  return (
    <article className={styles.algorithmClusterCard} data-polarity={props.cluster.polarity}>
      <span>
        {props.cluster.polarity === "positive"
          ? t.algorithmTransparency.clusters.positive
          : t.algorithmTransparency.clusters.negative}
      </span>
      <strong>{clusterDisplayName(props.cluster, props.index, t)}</strong>
      {props.cluster.family ? (
        <p>
          {t.algorithmTransparency.families.clusterFamily}:{" "}
          {props.cluster.family.displayLabel}
        </p>
      ) : null}
      <p>
        {t.algorithmTransparency.clusters.sourceLabel}:{" "}
        {t.algorithmTransparency.clusters.source[source]} ·{" "}
        {t.algorithmTransparency.clusters.confidenceLabel}:{" "}
        {t.algorithmTransparency.clusters.confidence[confidenceBucket(confidence)]}
        {confidence < 0.4 ? ` · ${t.algorithmTransparency.clusters.lowConfidence}` : ""}
      </p>
      {props.cluster.manualLabel && props.cluster.autoLabel ? (
        <p>{t.algorithmTransparency.clusters.autoInference(props.cluster.autoLabel)}</p>
      ) : null}
      {props.cluster.labelDiagnostics?.collision ? (
        <p>{t.algorithmTransparency.clusters.collisionResolved}</p>
      ) : null}
      {props.cluster.labelDiagnostics?.lowConfidence ? (
        <p>{t.algorithmTransparency.clusters.lowConfidenceAdvice}</p>
      ) : null}
      {props.cluster.mergeDiagnostics?.topCandidate ? (
        <p>
          {t.algorithmTransparency.clusters.possibleDuplicate(
            props.cluster.mergeDiagnostics.topCandidate.otherLabel,
            formatPercent(props.cluster.mergeDiagnostics.topCandidate.centroidSimilarity)
          )}
        </p>
      ) : null}
      <p>
        {t.algorithmTransparency.clusters.details(
          formatCompactNumber(props.cluster.weight),
          props.cluster.sampleCount,
          formatDate(props.cluster.updatedAt)
        )}
        {evidenceCount > 0 ? ` · ${t.algorithmTransparency.clusters.evidence(evidenceCount)}` : ""}
        {props.cluster.lastGeneratedAt
          ? ` · ${t.algorithmTransparency.clusters.generatedAt(formatDate(props.cluster.lastGeneratedAt))}`
          : ""}
      </p>
      {topTerms.length > 0 ? (
        <p>
          <strong>{t.algorithmTransparency.clusters.topTerms}</strong>
          <br />
          {topTerms.slice(0, 5).join(" / ")}
        </p>
      ) : null}
      {representativeArticles.length > 0 ? (
        <div className={styles.clusterEvidenceList}>
          <strong>{t.algorithmTransparency.clusters.representativeArticles}</strong>
          <ul>
            {representativeArticles.slice(0, 3).map((article) => (
              <li key={article.articleId}>{article.title}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {feedTitles.length > 0 ? (
        <p>
          <strong>{t.algorithmTransparency.clusters.feedTitles}</strong>
          <br />
          {feedTitles.slice(0, 3).join(" / ")}
        </p>
      ) : null}
      {props.cluster.diagnostics ? (
        <p>
          <strong>
            {t.algorithmTransparency.clusters.risk[props.cluster.diagnostics.overfitRisk]}
          </strong>
          <br />
          {t.algorithmTransparency.clusters.diagnostics(
            props.cluster.diagnostics.supportArticleCount,
            props.cluster.diagnostics.sourceCount,
            formatPercent(props.cluster.diagnostics.strongSignalRatio),
            formatPercent(props.cluster.diagnostics.topSourceShare),
            formatPercent(props.cluster.diagnostics.averageSimilarity)
          )}
          {props.cluster.diagnostics.warnings.length > 0
            ? ` · ${props.cluster.diagnostics.warnings.join(" / ")}`
            : ""}
        </p>
      ) : null}
      {isEditing ? (
        <form className={styles.clusterLabelForm} onSubmit={handleSubmit}>
          <label>
            {t.algorithmTransparency.clusters.renameLabel}
            <input
              maxLength={30}
              onChange={(event) => setDraftLabel(event.target.value)}
              placeholder={t.algorithmTransparency.clusters.renamePlaceholder}
              value={draftLabel}
            />
          </label>
          <div className={styles.clusterLabelActions}>
            <button className={styles.primaryButton} disabled={props.updating} type="submit">
              {t.algorithmTransparency.clusters.saveLabel}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={props.updating}
              onClick={() => setIsEditing(false)}
              type="button"
            >
              {t.algorithmTransparency.clusters.cancelRename}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.clusterLabelActions}>
          <button
            className={styles.secondaryButton}
            disabled={props.updating}
            onClick={() => setIsEditing(true)}
            type="button"
          >
            {t.algorithmTransparency.clusters.rename}
          </button>
          {props.cluster.manualLabel ? (
            <button
              className={styles.secondaryButton}
              disabled={props.updating}
              onClick={() => void handleClearManualLabel()}
              type="button"
            >
              {t.algorithmTransparency.clusters.clearManualLabel}
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}
