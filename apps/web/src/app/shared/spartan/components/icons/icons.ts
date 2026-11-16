import { inject, InjectionToken, type Provider } from "@angular/core";
import { NgIconsToken } from "@ng-icons/core";

/**
 * App-level icon overrides for every helm, composite and house component.
 *
 * Components register their default glyphs with {@link provideHlmIcons} instead of `provideIcons`,
 * so a consumer can replace any of them by name without a library release — e.g. swap the house
 * material-symbols chevrons for heroicons:
 *
 * ```ts
 * import { heroChevronDown, heroXMark } from "@ng-icons/heroicons/outline";
 *
 * providers: [
 *   provideHlmIconOverrides({
 *     matKeyboardArrowDownRound: heroChevronDown,
 *     matCloseRound: heroXMark,
 *   }),
 * ];
 * ```
 *
 * Keys are the default icon names the components use (see `ICONS` in `scripts/house.mjs` for the
 * helm set); values are SVG strings, as `@ng-icons/*` packages export them. Provide at the root for
 * the whole app, or on any component/route for a subtree; nested providers merge over their
 * parents.
 */
export const HLM_ICON_OVERRIDES = new InjectionToken<Readonly<Record<string, string>>>(
  "HLM_ICON_OVERRIDES",
);

/** Replace default component icons by name. Merges over overrides provided higher up. */
export function provideHlmIconOverrides(icons: Record<string, string>): Provider {
  return {
    provide: HLM_ICON_OVERRIDES,
    useFactory: () => ({
      ...inject(HLM_ICON_OVERRIDES, { optional: true, skipSelf: true }),
      ...icons,
    }),
  };
}

/**
 * Drop-in for `provideIcons` in library components: registers `icons` as defaults, with any
 * {@link HLM_ICON_OVERRIDES} for the same names taking precedence.
 */
export function provideHlmIcons(icons: Record<string, string>): Provider {
  return {
    provide: NgIconsToken,
    useFactory: () => {
      const parents = inject(NgIconsToken, { optional: true, skipSelf: true }) ?? [];
      const overrides = inject(HLM_ICON_OVERRIDES, { optional: true }) ?? {};
      const own: Record<string, string> = {};
      for (const [name, svg] of Object.entries(icons)) own[name] = overrides[name] ?? svg;
      return { ...parents.reduce((acc, set) => ({ ...acc, ...set }), {}), ...own };
    },
    multi: true,
  };
}
