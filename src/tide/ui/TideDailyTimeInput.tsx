import TideIcon from './TideIcon';
import { normalizeTideTimePart, replaceTideTimePart, stepTideTimePart, tideTimePartIsValid } from './tide-time-value';

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  hourLabel: string;
  minuteLabel: string;
  describedBy?: string;
}

export default function TideDailyTimeInput({ value, onChange, label, hourLabel, minuteLabel, describedBy }: Props) {
  const parts = value.split(':');
  return <div className="tide-schedule__clock" role="group" aria-label={label} aria-describedby={describedBy}>
    <span className="tide-schedule__clock-icon"><TideIcon name="clock" /></span>
    {([0, 1] as const).map(part => {
      const partValue = parts[part] ?? '';
      const maximum = part === 0 ? 23 : 59;
      const valid = tideTimePartIsValid(partValue, maximum);
      return <span className="tide-schedule__clock-part" key={part}>
        {part === 1 && <span className="tide-schedule__clock-separator" aria-hidden="true">:</span>}
        <input type="text" role="spinbutton" inputMode="numeric" autoComplete="off" maxLength={2}
          value={partValue} aria-label={part === 0 ? hourLabel : minuteLabel}
          aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={valid ? Number(partValue) : undefined}
          aria-invalid={!valid} aria-describedby={describedBy}
          onFocus={event => event.currentTarget.select()}
          onChange={event => {
            if (/^\d{0,2}$/.test(event.target.value)) onChange(replaceTideTimePart(value, part, event.target.value));
          }}
          onBlur={() => {
            const normalized = normalizeTideTimePart(partValue);
            if (normalized !== partValue) onChange(replaceTideTimePart(value, part, normalized));
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              const normalized = normalizeTideTimePart(partValue);
              if (normalized !== partValue) onChange(replaceTideTimePart(value, part, normalized));
              return;
            }
            const next = stepTideTimePart(partValue, maximum, event.key);
            if (next !== null) {
              event.preventDefault();
              onChange(replaceTideTimePart(value, part, next));
            }
          }} />
      </span>;
    })}
  </div>;
}
