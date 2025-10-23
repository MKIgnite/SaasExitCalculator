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
  inputScale?: number;
  inputPrecision?: number;
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
  inputScale = 1,
  inputPrecision = 6,
}) => {
  const isLinearScale = scale === 'linear';

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
    const baseSliderValue = isLinearScale ? sliderValue / inputScale : sliderValue;
    const next = clampValue(fromSliderValue(baseSliderValue));
    onChange(applyStep(next));
  };

  const handleNumberChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const numericValue = clampValue(
      isLinearScale ? Number(event.target.value) / inputScale : Number(event.target.value)
    );
    onChange(applyStep(numericValue));
  };

  const sliderMinBase = scale === 'log' ? Math.log10(min) : min;
  const sliderMaxBase = scale === 'log' ? Math.log10(max) : max;
  const sliderValueBase = toSliderValue(value);
  const sliderMin = isLinearScale ? sliderMinBase * inputScale : sliderMinBase;
  const sliderMax = isLinearScale ? sliderMaxBase * inputScale : sliderMaxBase;
  const sliderValue = isLinearScale ? sliderValueBase * inputScale : sliderValueBase;
  const sliderStepValue = (() => {
    if (sliderStep !== undefined) {
      return sliderStep * (isLinearScale ? inputScale : 1);
    }
    if (scale === 'log') {
      return (sliderMaxBase - sliderMinBase) / 120;
    }
    return step * (isLinearScale ? inputScale : 1);
  })();

  const numberMin = isLinearScale ? min * inputScale : min;
  const numberMax = isLinearScale ? max * inputScale : max;
  const numberStep = step ? step * (isLinearScale ? inputScale : 1) : undefined;
  const numberValue = isLinearScale ? value * inputScale : value;

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
        <div className="slider-input__controls">
          <input
            type="number"
            min={numberMin}
            max={numberMax}
            step={numberStep}
            value={Number(numberValue.toFixed(inputPrecision))}
            onChange={handleNumberChange}
            aria-label={`${label} numeric input`}
          />
          <span>
            {format ? format(value) : value.toFixed(2)}
            {suffix ?? ''}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SliderInput;
