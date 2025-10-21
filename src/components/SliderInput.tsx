import React from 'react';

export interface SliderInputProps {
  label: string;
  description?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  suffix?: string;
  scale?: 'linear' | 'log';
  sliderStep?: number;
}

const SliderInput: React.FC<SliderInputProps> = ({
  label,
  description,
  min,
  max,
  step = 1,
  value,
  onChange,
  format,
  suffix,
  scale = 'linear',
  sliderStep,
}) => {
  const clampValue = (next: number) => {
    if (Number.isNaN(next)) return value;
    if (next < min) return min;
    if (next > max) return max;
    return next;
  };

  const toSliderValue = (numericValue: number) => {
    if (scale === 'log') {
      const safeValue = Math.max(numericValue, Number.EPSILON);
      return Math.log10(safeValue);
    }
    return numericValue;
  };

  const fromSliderValue = (sliderValue: number) => {
    if (scale === 'log') {
      return Math.pow(10, sliderValue);
    }
    return sliderValue;
  };

  const applyStep = (valueToClamp: number) => {
    if (!step) {
      return valueToClamp;
    }
    const stepped = Math.round(valueToClamp / step) * step;
    return Number(stepped.toFixed(6));
  };

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sliderValue = Number(event.target.value);
    const next = clampValue(fromSliderValue(sliderValue));
    onChange(applyStep(next));
  };

  const handleNumberChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const numericValue = clampValue(Number(event.target.value));
    onChange(applyStep(numericValue));
  };

  const sliderMin = scale === 'log' ? Math.log10(min) : min;
  const sliderMax = scale === 'log' ? Math.log10(max) : max;
  const sliderValue = toSliderValue(value);
  const sliderStepValue =
    sliderStep ?? (scale === 'log' ? (sliderMax - sliderMin) / 120 : step);

  return (
    <div className="control-row">
      <label>
        {label}
        {description && <small>{description}</small>}
      </label>
      <div className="slider-input">
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={sliderStepValue}
          value={sliderValue}
          onChange={handleSliderChange}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(6))}
          onChange={handleNumberChange}
          aria-label={`${label} numeric input`}
        />
        <span>{format ? format(value) : value.toFixed(2)}{suffix}</span>
      </div>
    </div>
  );
};

export default SliderInput;
