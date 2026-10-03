import JsBarcode from 'jsbarcode';

/**
 * Generates Code-128 barcode into an HTML SVG or Canvas element.
 */
export function renderCode128Barcode(
  element: SVGElement | HTMLCanvasElement,
  value: string,
  options: {
    width?: number;
    height?: number;
    fontSize?: number;
    displayValue?: boolean;
    margin?: number;
  } = {}
): void {
  if (!value) return;

  try {
    JsBarcode(element, value, {
      format: 'CODE128',
      width: options.width ?? 1.8,
      height: options.height ?? 40,
      displayValue: options.displayValue ?? true,
      fontSize: options.fontSize ?? 12,
      font: 'monospace',
      textAlign: 'center',
      textPosition: 'bottom',
      textMargin: 2,
      margin: options.margin ?? 4,
      background: '#ffffff',
      lineColor: '#000000'
    });
  } catch (err) {
    console.warn('[JsBarcode] Error rendering barcode:', err);
  }
}
