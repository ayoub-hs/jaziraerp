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
  disallowZero = false
}) => {
  const [text, setText] = useState<string>(String(value));
  const keyTimestampsRef = useRef<number[]>([]);
  const isBurstRef = useRef<boolean>(false);

  useEffect(() => {
    setText(String(value));
    isBurstRef.current = false;
    keyTimestampsRef.current = [];
  }, [value]);

  const commit = () => {
    if (isBurstRef.current) {
      setText(String(value));
      isBurstRef.current = false;
      keyTimestampsRef.current = [];
      return;
    }

    const trimmed = text.trim();
    if (trimmed === '') {
      setText(String(value));
      return;
    }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed) && (!disallowZero || parsed > 0) && parsed >= min) {
      const capped = Math.min(parsed, max);
      if (capped !== value) {
        onCommit(capped);
      }
      setText(String(capped));
    } else {
      setText(String(value)); // Revert if invalid
    }
    isBurstRef.current = false;
    keyTimestampsRef.current = [];
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Detect rapid keystroke burst of digits (>= 6 digits within ~100 ms)
    if (e.key >= '0' && e.key <= '9') {
      const now = Date.now();
      keyTimestampsRef.current = keyTimestampsRef.current.filter(t => now - t <= 100);
      keyTimestampsRef.current.push(now);

      if (keyTimestampsRef.current.length >= 6) {
        isBurstRef.current = true;
        setText(String(value));
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
      setText(String(value));
      return;
    }
    const newVal = e.target.value;
    // Guard against pasted or bundled barcode scan bursts (>= 6 digits)
    if (newVal.length - text.length >= 6 && /^\d+$/.test(newVal.replace('.', ''))) {
      isBurstRef.current = true;
      setText(String(value));
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
      onChange={handleChange}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
};
