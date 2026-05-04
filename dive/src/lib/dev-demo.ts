export function hasDevDemoParam(
  search = typeof window === "undefined" ? "" : window.location.search,
): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).has("demo");
}
