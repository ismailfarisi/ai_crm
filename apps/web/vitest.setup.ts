import '@testing-library/jest-dom/vitest';

/**
 * jsdom ships `<dialog>` but not its modal behaviour, so any component built on
 * `showModal()` throws "element.showModal is not a function" the moment it
 * renders. Our `Dialog` primitive is built on exactly that, which put every
 * dialog-based component out of reach of a test.
 *
 * These stand-ins do the one thing the components depend on: keep the `open`
 * attribute in step with the calls, so `open`/`close` and the `[open]`
 * selectors behave. Nothing here emulates focus trapping or the top layer —
 * a test that needs those wants a browser.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
      returnValue?: string,
    ) {
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event('close'));
    };
  }
}
