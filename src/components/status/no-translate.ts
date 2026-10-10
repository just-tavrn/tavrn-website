// SPDX-License-Identifier: Apache-2.0
/**
 * Marks an element translate="no" (names, domains, versions, capability ids). A ref callback instead of the
 * attribute: Preact assigns `translate` as the boolean DOM property, which turns the string "no" into "yes".
 */
export function noTranslate(element: Element | null): void {
  element?.setAttribute("translate", "no");
}
