import { KeyboardWedgeScanner } from '../../../src/services/hardware/scanner.js';

function testDoubleAddOnSearchInput() {
  console.log('\n=== TESTING POS-01: DOUBLE ADD ON SEARCH INPUT FOCUS ===');
  const scanner = new KeyboardWedgeScanner(60);

  let scannerCallbackCount = 0;
  let searchInputEnterCount = 0;

  // Global scanner listener (like DesktopPos.tsx line 171)
  scanner.onScan((barcode) => {
    scannerCallbackCount++;
    console.log(`[Global Scanner] onScan fired with barcode: "${barcode}"`);
  });

  // Simulated search <input data-scanner-input="true" />
  const fakeSearchInput = {
    tagName: 'INPUT',
    hasAttribute: (attr: string) => attr === 'data-scanner-input',
    value: ''
  };

  // Simulated handleSearchKeyDown (like DesktopPos.tsx line 360)
  const handleSearchKeyDown = (e: { key: string, preventDefault: () => void }) => {
    if (e.key === 'Enter') {
      searchInputEnterCount++;
      console.log(`[Search Input onKeyDown] Enter listener fired, value="${fakeSearchInput.value}"`);
      e.preventDefault();
    }
  };

  const barcode = '619001234567';

  // Scanner types characters rapidly into the input
  for (const char of barcode) {
    fakeSearchInput.value += char;
    scanner.handleKeyDown({
      key: char,
      target: fakeSearchInput as any,
      preventDefault: () => {}
    } as any);
  }

  // Scanner sends terminating Enter
  const enterEvent = {
    key: 'Enter',
    target: fakeSearchInput as any,
    defaultPrevented: false,
    preventDefault: () => {
      enterEvent.defaultPrevented = true;
    }
  };

  // 1. Input listener receives Enter first
  handleSearchKeyDown(enterEvent);

  // 2. Global window scanner listener receives Enter
  scanner.handleKeyDown(enterEvent as any);

  console.log(`RESULT: Search input Enter fired: ${searchInputEnterCount} time(s)`);
  console.log(`RESULT: Global scanner callback fired: ${scannerCallbackCount} time(s)`);
  console.log(`TOTAL addProductToCart invocations for 1 scan: ${searchInputEnterCount + scannerCallbackCount}`);

  if (searchInputEnterCount + scannerCallbackCount === 2) {
    console.log('BUG CONFIRMED: A single hardware barcode scan triggers TWO addProductToCart calls!');
  }
}

function testCheckoutModalBarcodePollution() {
  console.log('\n=== TESTING POS-02: BARCODE POLLUTION IN CHECKOUT MODAL ===');
  const scanner = new KeyboardWedgeScanner(60);

  let scannerCallbackCount = 0;
  scanner.onScan((barcode) => {
    scannerCallbackCount++;
  });

  // Cash input inside CheckoutModal (no data-scanner-input)
  const fakeCashInput = {
    tagName: 'INPUT',
    hasAttribute: (attr: string) => false,
    value: ''
  };

  const barcode = '619001234567';

  // Scanner sends barcode while cash input is focused
  for (const char of barcode) {
    // scanner sees input without data-scanner-input, ignores it (scanner.ts line 51)
    scanner.handleKeyDown({
      key: char,
      target: fakeCashInput as any,
      preventDefault: () => {}
    } as any);
    // Native browser input receives key and updates value
    fakeCashInput.value += char;
  }

  // Terminating Enter
  let modalSubmitted = false;
  const handleModalKeyDown = (e: { key: string }) => {
    if (e.key === 'Enter') {
      const parsedCash = parseFloat(fakeCashInput.value);
      if (parsedCash > 0) {
        modalSubmitted = true;
      }
    }
  };

  handleModalKeyDown({ key: 'Enter' });

  console.log('RESULT: Global scanner caught barcode:', scannerCallbackCount, '(Item was NOT added to cart!)');
  console.log('RESULT: Cash input polluted with barcode number:', fakeCashInput.value);
  console.log('RESULT: Premature checkout modal submit triggered:', modalSubmitted);

  if (modalSubmitted && fakeCashInput.value === barcode && scannerCallbackCount === 0) {
    console.log('BUG CONFIRMED: Hardware scan types barcode as cash tendered and submits premature sale!');
  }
}

testDoubleAddOnSearchInput();
testCheckoutModalBarcodePollution();
