// Single definition of global navigation destinations. Shell components render
// from this list; feature pages never define global navigation themselves.
// Replacing the header with another pattern (sidebar, bottom tabs) means writing
// a new renderer for this list, not editing pages.

export type NavItem = {
  label: string;
  href: string;
  /** Exact match only (Home), otherwise the item is active for nested routes too. */
  exact?: boolean;
  /** Shown only to signed-in users. */
  signedInOnly?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Home", href: "/", exact: true },
  { label: "Dashboard", href: "/dashboard", signedInOnly: true },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
