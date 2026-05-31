import { useEffect, useState } from "react";
import type { CreateEmbeddingProviderInput, EmbeddingProvider, UpdateEmbeddingProviderInput } from "../api.js";
import { useI18n } from "../i18n.js";
import styles from "../design-system/AppShell/AppShell.module.css";
import { NumberSettingField } from "../ui/FormFields.js";
import { classNames, draftForEmbeddingProvider, draftWithProviderType, embeddingProviderDraftMatchesProvider, newEmbeddingProviderId, parseEmbeddingProviderDraft, providerRecommendationReadmeUrl, type EmbeddingProviderDraft } from "../app/shared.js";

export function SetupProviderPanel(props: {
  activatingProviderId: string | null;
  embeddingError: string | null;
  embeddingProviders: EmbeddingProvider[];
  isEmbeddingLoading: boolean;
  isSavingEmbeddingProvider: boolean;
  testingProviderId: string | null;
  onActivateEmbeddingProvider: (providerId: string) => Promise<boolean>;
  onContinue: () => void;
  onSaveEmbeddingProvider: (
    providerId: string | null,
    input: CreateEmbeddingProviderInput | UpdateEmbeddingProviderInput
  ) => Promise<string | null>;
  onTestEmbeddingProvider: (providerId: string) => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const initialProvider =
    props.embeddingProviders.find((provider) => provider.enabled) ??
    props.embeddingProviders[0] ??
    null;
  const [providerDraft, setProviderDraft] = useState<EmbeddingProviderDraft>(() =>
    draftForEmbeddingProvider(initialProvider)
  );
  const [pendingProviderSelectionId, setPendingProviderSelectionId] = useState<string | null>(null);
  const [providerLocalError, setProviderLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingProviderSelectionId) {
      const pendingProvider = props.embeddingProviders.find(
        (provider) => provider.id === pendingProviderSelectionId
      );
      if (pendingProvider) {
        setProviderDraft(draftForEmbeddingProvider(pendingProvider));
        setPendingProviderSelectionId(null);
        setProviderLocalError(null);
        return;
      }
    }

    const selectedProvider = props.embeddingProviders.find(
      (provider) => provider.id === providerDraft.providerId
    );
    if (selectedProvider) {
      setProviderDraft(draftForEmbeddingProvider(selectedProvider));
      setProviderLocalError(null);
      return;
    }

    const activeProvider =
      props.embeddingProviders.find((provider) => provider.enabled) ??
      props.embeddingProviders[0] ??
      null;
    setProviderDraft(draftForEmbeddingProvider(activeProvider));
    setProviderLocalError(null);
  }, [pendingProviderSelectionId, props.embeddingProviders]);

  async function handleProviderTestSubmit() {
    const parsed = parseEmbeddingProviderDraft(providerDraft, t);

    if (!parsed.ok) {
      setProviderLocalError(parsed.error);
      return;
    }

    setProviderLocalError(null);
    const savedProviderId = await props.onSaveEmbeddingProvider(
      providerDraft.providerId === newEmbeddingProviderId ? null : providerDraft.providerId,
      {
        ...parsed.input,
        enabled: selectedProvider?.enabled ?? false
      }
    );
    if (savedProviderId) {
      setPendingProviderSelectionId(savedProviderId);
      await props.onTestEmbeddingProvider(savedProviderId);
    }
  }

  async function handleProviderEnableSubmit() {
    if (!selectedProvider || !canFinalizeSelectedProvider) {
      setProviderLocalError(t.setup.provider.testRequired);
      return;
    }

    setProviderLocalError(null);
    if (selectedProvider.enabled) {
      props.onContinue();
      return;
    }

    const activated = await props.onActivateEmbeddingProvider(selectedProvider.id);
    if (activated) {
      props.onContinue();
    }
  }

  const selectedProvider =
    providerDraft.providerId === newEmbeddingProviderId
      ? null
      : props.embeddingProviders.find((provider) => provider.id === providerDraft.providerId) ??
        null;
  const selectedProviderDraftMatches =
    selectedProvider !== null && embeddingProviderDraftMatchesProvider(providerDraft, selectedProvider);
  const canFinalizeSelectedProvider =
    selectedProvider !== null &&
    selectedProvider.lastTestStatus === "success" &&
    selectedProviderDraftMatches;
  const isActivatingSelectedProvider =
    selectedProvider !== null && props.activatingProviderId === selectedProvider.id;
  const isTestingSelectedProvider =
    selectedProvider !== null && props.testingProviderId === selectedProvider.id;
  const isPrimaryProviderActionBusy =
    props.isSavingEmbeddingProvider || isTestingSelectedProvider || isActivatingSelectedProvider;

  return (
    <section
      className={classNames(styles.authPanel, styles.setupProviderPanel)}
      aria-labelledby="setup-provider-title"
    >
      <div className={styles.brand}>
        <img alt="" className={styles.brandMark} src="/logo-64.png" />
        <span>
          <strong>{t.common.brandName}</strong>
          <small>{t.common.brandSubtitle}</small>
        </span>
      </div>
      <div>
        <p className={styles.kicker}>{t.setup.kicker}</p>
        <h1 id="setup-provider-title">{t.setup.provider.title}</h1>
        <p>{t.setup.provider.body}</p>
        <a
          className={styles.textLink}
          href={providerRecommendationReadmeUrl(locale)}
          rel="noreferrer"
          target="_blank"
        >
          {t.setup.provider.recommendationLink}
        </a>
      </div>

      {props.isEmbeddingLoading ? (
        <p className={styles.settingsNotice}>{t.settings.sections.provider.loading}</p>
      ) : null}
      {props.embeddingError ? <p className={styles.errorText}>{props.embeddingError}</p> : null}
      {providerLocalError ? <p className={styles.errorText}>{providerLocalError}</p> : null}

      {props.embeddingProviders.length > 0 ? (
        <div
          aria-label={t.settings.sections.provider.profileListLabel}
          className={styles.providerProfileList}
        >
          {props.embeddingProviders.map((provider) => (
            <button
              className={
                provider.id === providerDraft.providerId
                  ? styles.providerProfileCardActive
                  : styles.providerProfileCard
              }
              key={provider.id}
              onClick={() => {
                setProviderDraft(draftForEmbeddingProvider(provider));
                setProviderLocalError(null);
              }}
              type="button"
            >
              <span>
                <strong>{provider.name}</strong>
                <small>
                  {provider.type} · {provider.model} / {provider.dimension}
                </small>
              </span>
              <em>
                {provider.enabled
                  ? t.settings.sections.provider.currentBadge
                  : t.settings.sections.provider.profileBadge}
              </em>
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.settingsGrid}>
        <label className={styles.settingsField} htmlFor="setup-provider-select">
          <span>{t.settings.sections.provider.providerLabel}</span>
          <select
            id="setup-provider-select"
            onChange={(event) => {
              const provider =
                props.embeddingProviders.find(
                  (candidate) => candidate.id === event.target.value
                ) ?? null;
              setProviderDraft(draftForEmbeddingProvider(provider));
              setProviderLocalError(null);
            }}
            value={providerDraft.providerId}
          >
            <option value={newEmbeddingProviderId}>
              {t.settings.sections.provider.newProvider}
            </option>
            {props.embeddingProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.settingsField} htmlFor="setup-provider-type">
          <span>{t.settings.sections.provider.typeLabel}</span>
          <select
            id="setup-provider-type"
            onChange={(event) => {
              const nextType =
                event.target.value === "ollama"
                  ? "ollama"
                  : event.target.value === "gemini"
                    ? "gemini"
                    : "openai_compatible";
              setProviderDraft(draftWithProviderType(providerDraft, nextType));
              setProviderLocalError(null);
            }}
            value={providerDraft.type}
          >
            <option value="openai_compatible">
              {t.settings.sections.provider.openaiCompatible}
            </option>
            <option value="gemini">{t.settings.sections.provider.gemini}</option>
            <option value="ollama">{t.settings.sections.provider.ollama}</option>
          </select>
        </label>

        <label className={styles.settingsField} htmlFor="setup-provider-name">
          <span>{t.settings.sections.provider.nameLabel}</span>
          <input
            id="setup-provider-name"
            onChange={(event) =>
              setProviderDraft({ ...providerDraft, name: event.target.value })
            }
            value={providerDraft.name}
          />
        </label>

        <label className={styles.settingsField} htmlFor="setup-provider-base-url">
          <span>{t.settings.sections.provider.baseUrlLabel}</span>
          <input
            id="setup-provider-base-url"
            inputMode="url"
            onChange={(event) =>
              setProviderDraft({ ...providerDraft, baseUrl: event.target.value })
            }
            placeholder={
              providerDraft.type === "ollama"
                ? t.settings.sections.provider.ollamaBaseUrlPlaceholder
                : providerDraft.type === "gemini"
                  ? t.settings.sections.provider.geminiBaseUrlPlaceholder
                  : t.settings.sections.provider.baseUrlPlaceholder
            }
            type="url"
            value={providerDraft.baseUrl}
          />
        </label>

        <label className={styles.settingsField} htmlFor="setup-provider-model">
          <span>{t.settings.sections.provider.modelLabel}</span>
          <input
            id="setup-provider-model"
            onChange={(event) =>
              setProviderDraft({ ...providerDraft, model: event.target.value })
            }
            placeholder={
              providerDraft.type === "ollama"
                ? t.settings.sections.provider.ollamaModelPlaceholder
                : providerDraft.type === "gemini"
                  ? t.settings.sections.provider.geminiModelPlaceholder
                  : t.settings.sections.provider.modelPlaceholder
            }
            value={providerDraft.model}
          />
        </label>

        <NumberSettingField
          id="setup-provider-dimension"
          label={t.settings.sections.provider.dimensionLabel}
          max={20000}
          min={1}
          onChange={(value) => setProviderDraft({ ...providerDraft, dimension: value })}
          step={1}
          value={providerDraft.dimension}
        />

        <NumberSettingField
          id="setup-provider-text-max-chars"
          label={t.settings.sections.provider.textMaxCharsLabel}
          max={200000}
          min={1000}
          onChange={(value) => setProviderDraft({ ...providerDraft, textMaxChars: value })}
          step={500}
          value={providerDraft.textMaxChars}
        />

        <NumberSettingField
          id="setup-provider-qpm"
          label={t.settings.sections.provider.requestsPerMinuteLabel}
          max={1000000}
          min={1}
          onChange={(value) =>
            setProviderDraft({ ...providerDraft, requestsPerMinute: value })
          }
          placeholder={t.settings.sections.provider.unlimitedPlaceholder}
          step={1}
          value={providerDraft.requestsPerMinute}
        />

        <NumberSettingField
          id="setup-provider-qpd"
          label={t.settings.sections.provider.requestsPerDayLabel}
          max={100000000}
          min={1}
          onChange={(value) => setProviderDraft({ ...providerDraft, requestsPerDay: value })}
          placeholder={t.settings.sections.provider.unlimitedPlaceholder}
          step={1}
          value={providerDraft.requestsPerDay}
        />

        {providerDraft.type !== "ollama" ? (
          <label className={styles.settingsField} htmlFor="setup-provider-api-key">
            <span>{t.settings.sections.provider.apiKeyLabel}</span>
            <input
              autoComplete="off"
              id="setup-provider-api-key"
              onChange={(event) =>
                setProviderDraft({ ...providerDraft, apiKey: event.target.value })
              }
              placeholder={
                selectedProvider?.hasApiKey
                  ? t.settings.sections.provider.apiKeyRetainPlaceholder
                  : t.settings.sections.provider.apiKeyPlaceholder
              }
              type="password"
              value={providerDraft.apiKey}
            />
          </label>
        ) : (
          <p className={styles.managementHint}>
            {t.settings.sections.provider.ollamaApiKeyHint}
          </p>
        )}

        <label className={styles.settingsField} htmlFor="setup-provider-quality">
          <span>{t.settings.sections.provider.qualityTierLabel}</span>
          <select
            id="setup-provider-quality"
            onChange={(event) =>
              setProviderDraft({
                ...providerDraft,
                qualityTier: event.target.value as EmbeddingProviderDraft["qualityTier"]
              })
            }
            value={providerDraft.qualityTier}
          >
            <option value="basic">{t.settings.sections.provider.quality.basic}</option>
            <option value="recommended">
              {t.settings.sections.provider.quality.recommended}
            </option>
            <option value="best_quality">
              {t.settings.sections.provider.quality.bestQuality}
            </option>
          </select>
        </label>
      </div>

      <p className={styles.providerWarning}>{t.settings.sections.provider.modelHint}</p>
      <p className={styles.providerWarning}>{t.settings.sections.provider.rateLimitHint}</p>

      <div className={styles.setupStatusBox}>
        <strong>{t.setup.provider.currentTitle}</strong>
        <p>{t.setup.provider.currentBody}</p>
      </div>

      {selectedProvider ? (
        <div className={styles.setupStatusBox}>
          <strong>{t.settings.sections.provider.connectionStatusTitle}</strong>
          <p>
            {selectedProvider.lastTestStatus === "success"
              ? t.settings.sections.provider.lastTestSuccess(
                  selectedProvider.lastTestAt ?? t.feedManagement.na
                )
              : selectedProvider.lastTestStatus === "failed"
                ? t.settings.sections.provider.lastTestFailed(
                    selectedProvider.lastTestError ?? t.feedManagement.na
                  )
                : t.settings.sections.provider.lastTestUnknown}
          </p>
          {selectedProvider.lastTestStatus === "success" && !selectedProviderDraftMatches ? (
            <p>{t.setup.provider.testStale}</p>
          ) : null}
        </div>
      ) : null}

      <div className={styles.managementActions}>
        <button
          className={styles.primaryButton}
          disabled={isPrimaryProviderActionBusy}
          onClick={() =>
            void (canFinalizeSelectedProvider
              ? handleProviderEnableSubmit()
              : handleProviderTestSubmit())
          }
          type="button"
        >
          {isActivatingSelectedProvider
            ? t.settings.sections.provider.activating
            : props.isSavingEmbeddingProvider
              ? t.setup.provider.saving
              : isTestingSelectedProvider
                ? t.settings.sections.provider.testing
                : canFinalizeSelectedProvider
                  ? selectedProvider?.enabled
                    ? t.setup.provider.useProviderAndContinue
                    : t.setup.provider.enableAndContinue
                  : t.setup.provider.saveAndTest}
        </button>
        <button className={styles.secondaryButton} onClick={props.onContinue} type="button">
          {t.setup.provider.continue}
        </button>
      </div>
    </section>
  );
}
