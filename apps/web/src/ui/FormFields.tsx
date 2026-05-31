import styles from "../design-system/AppShell/AppShell.module.css";

export function NumberSettingField(props: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  placeholder?: string;
  step: number;
  unit?: string;
  value: string;
}) {
  return (
    <label className={styles.settingsField} htmlFor={props.id}>
      <span>{props.label}</span>
      <div className={styles.settingsNumberRow}>
        <input
          id={props.id}
          max={props.max}
          min={props.min}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          step={props.step}
          type="number"
          value={props.value}
        />
        {props.unit ? <small>{props.unit}</small> : null}
      </div>
    </label>
  );
}

export function RangeSettingField(props: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  step: number;
  unit?: string;
  value: string;
}) {
  return (
    <label className={styles.settingsField} htmlFor={props.id}>
      <span>{props.label}</span>
      <div className={styles.settingsRangeRow}>
        <input
          id={props.id}
          max={props.max}
          min={props.min}
          onChange={(event) => props.onChange(event.target.value)}
          step={props.step}
          type="range"
          value={props.value}
        />
        <strong>
          {props.value}
          {props.unit ? ` ${props.unit}` : ""}
        </strong>
      </div>
      <div className={styles.settingsRangeScale} aria-hidden="true">
        <span>{props.min}</span>
        <span>{props.max}</span>
      </div>
    </label>
  );
}
