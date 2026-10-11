import React, { useState, useEffect, useRef } from 'react';

interface BufferedNumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: string | number;
  className?: string;
  title?: string;
  placeholder?: string;
  onCommit: (value: number) => void;
  disallowZero?: boolean;
  displayDecimals?: number;
}

export const BufferedNumberInput: React.FC<BufferedNumberInputProps> = ({
  value,
  min = 0,
  max = 9999,
  step = 'any',
  className = '',
  title,
  placeholder,
  onCommit,
  disallowZero = false,
  displayDecimals
}) => {
  const formatValue = (v: number): string => {
    if (typeof displayDecimals === 'number') {
      return Number(v).toFixed(displayDecimals);
    }
    return String(v);
  };

  const [text, setText] = useState<string>(formatValue(value));
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const prevValueRef = useRef<number>(value);
  const keyTimestampsRef = useRef<number[]>([]);
  const isBurstRef = useRef<boolean>(false);

  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setText(formatValue(value));
    }
    isBurstRef.current = false;
    keyTimestampsRef.current = [];
  }, [value, displayDecimals]);

  const commit = () => {
    if (isBurstRef.current) {
      setText(formatValue(value));
      isBurstRef.current = false;
      keyTimestampsRef.current = [];
      return;
    }

    const trimmed = text.trim();
    if (trimmed === '') {
      setText(formatValue(value));
      return;
    }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed) && (!disallowZero || parsed > 0) && parsed >= min) {
      const capped = Math.min(parsed, max);
      if (capped !== value) {
        onCommit(capped);
      }
      prevValueRef.current = capped;
      setText(formatValue(capped));
    } else {
      setText(formatValue(value)); // Revert if invalid
    }
    isBurstRef.current = false;
    keyTimestampsRef.current = [];
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    commit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Detect rapid keystroke burst of digits (>= 6 digits within ~100 ms)
    if (e.key >= '0' && e.key <= '9') {
      const now = Date.now();
      keyTimestampsRef.current = keyTimestampsRef.current.filter(t => now - t <= 100);
      keyTimestampsRef.current.push(now);

      if (keyTimestampsRef.current.length >= 6) {
        isBurstRef.current = true;
        setText(formatValue(value));
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isBurstRef.current) {
      setText(formatValue(value));
      return;
    }
    const newVal = e.target.value;
    // Guard against pasted or bundled barcode scan bursts (>= 6 digits)
    if (newVal.length - text.length >= 6 && /^\d+$/.test(newVal.replace('.', ''))) {
      isBurstRef.current = true;
      setText(formatValue(value));
      return;
    }
    setText(newVal);
  };

  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      title={title}
      placeholder={placeholder}
      className={className}
      value={text}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
    />
  );
};
