import { useCallback, useEffect, useMemo, useState } from "react";
import { dibaoApi, userMessageForError, type Feed, type FullContentPreviewResponse } from "../api.js";
import { useI18n } from "../i18n.js";
import styles from "../design-system/AppShell/AppShell.module.css";
import { sanitizeArticleHtml } from "../app/shared.js";

export function FullContentPreviewPage(props: {
  feed: Feed | null;
  feedId: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<FullContentPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadPreview = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setResult(await dibaoApi.previewFeedFullContent(props.feedId));
    } catch (caught) {
      setError(userMessageForError(caught, t.errors.api));
    } finally {
      setIsLoading(false);
    }
  }, [props.feedId, t.errors.api]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const safeHtml = useMemo(
    () => (result?.contentHtml ? sanitizeArticleHtml(result.contentHtml, result.articleUrl) : null),
    [result]
  );

  return (
    <section className={styles.settingsWorkspace} aria-labelledby="full-content-preview-title">
      <div className={styles.settingsHeader}>
        <div>
          <p className={styles.kicker}>{t.fullContentPreview.kicker}</p>
          <h2 id="full-content-preview-title">
            {props.feed?.title ?? t.fullContentPreview.pageTitle}
          </h2>
        </div>
        <div className={styles.managementActions}>
          <button className={styles.secondaryButton} onClick={props.onBack} type="button">
            {t.fullContentPreview.back}
          </button>
          <button
            className={styles.primaryButton}
            disabled={isLoading}
            onClick={() => void loadPreview()}
            type="button"
          >
            {isLoading ? t.fullContentPreview.loading : t.fullContentPreview.reload}
          </button>
        </div>
      </div>
      <section className={styles.settingsSection}>
        {error ? <p className={styles.errorText}>{error}</p> : null}
        {isLoading ? <p className={styles.settingsNotice}>{t.fullContentPreview.loading}</p> : null}
        {result ? (
          <>
            <dl className={styles.managementStatusRows}>
              <div>
                <dt>{t.fullContentPreview.articleUrl}</dt>
                <dd>{result.articleUrl}</dd>
              </div>
              <div>
                <dt>{t.fullContentPreview.resultStatus}</dt>
                <dd>{t.fullContentPreview.statuses[result.status]}</dd>
              </div>
              <div>
                <dt>{t.fullContentPreview.extractedTitle}</dt>
                <dd>{result.title ?? t.feedManagement.na}</dd>
              </div>
            </dl>
            {result.status === "success" ? (
              <article className={styles.reader}>
                {safeHtml ? (
                  <div
                    className={styles.readerBody}
                    dangerouslySetInnerHTML={{ __html: safeHtml }}
                  />
                ) : (
                  <div className={styles.readerBody}>
                    <p>{result.contentText ?? result.excerpt}</p>
                  </div>
                )}
              </article>
            ) : (
              <p className={styles.settingsNotice}>
                {result.error ?? t.fullContentPreview.noPreview} {t.fullContentPreview.noDbWrite}
              </p>
            )}
          </>
        ) : null}
      </section>
    </section>
  );
}
