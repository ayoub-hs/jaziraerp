import React, { useState, useEffect } from 'react';

interface BufferedNumberInputProps {
  value: number;
  min?: number;
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
  step = 'any',
  className = '',
  title,
  placeholder,
  onCommit,
  disallowZero = false
}) => {
  const [text, setText] = useState<string>(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setText(String(value));
      return;
    }
    const parsed = parseFloat(trimmed);
    if (!isNaN(parsed) && (!disallowZero || parsed > 0) && parsed >= min) {
      onCommit(parsed);
    } else {
      setText(String(value)); // Revert if invalid
    }
  };

  return (
    <input
      type="number"
      step={step}
      min={min}
      title={title}
      placeholder={placeholder}
      className={className}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};
