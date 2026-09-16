import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { CREDENTIAL_ROUTE_KEY, CredentialRoute } from '@/common/decorators';
import { AuthController } from './auth.controller';

/**
 * A named throttler applies to every route in the application unless it skips.
 *
 * The "auth" throttler exists to slow password guessing at ten attempts a
 * minute. Configured without a skip it capped the entire API at ten requests a
 * minute per visitor — every list, every page render — which is how
 * /purchasing/suppliers came to fail with a 500 whose cause was a 429.
 */
const reflector = new Reflector();

const contextFor = (handler: unknown): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => AuthController,
  }) as unknown as ExecutionContext;

/** The same predicate `app.module.ts` gives the throttler. */
const skips = (handler: unknown) =>
  !reflector.getAllAndOverride<boolean>(CREDENTIAL_ROUTE_KEY, [
    contextFor(handler).getHandler(),
    contextFor(handler).getClass(),
  ]);

describe('credential-route throttling', () => {
  const controller = AuthController.prototype;

  it('applies the strict limit where a credential is offered', () => {
    expect(skips(controller.login)).toBe(false);
    expect(skips(controller.register)).toBe(false);
    expect(skips(controller.acceptInvite)).toBe(false);
    expect(skips(controller.changePassword)).toBe(false);
  });

  it('leaves ordinary routes on the ordinary limit', () => {
    expect(skips(controller.me)).toBe(true);
    expect(skips(controller.logout)).toBe(true);
    // Anything outside this controller, which is the case that broke.
    expect(skips(function listSuppliers() {})).toBe(true);
  });

  it('marks a handler when the decorator is applied', () => {
    class Example {
      @CredentialRoute()
      method() {}
    }
    expect(
      reflector.get<boolean>(CREDENTIAL_ROUTE_KEY, Example.prototype.method),
    ).toBe(true);
  });
});
