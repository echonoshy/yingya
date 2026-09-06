/** Keep imperative transitions aligned with the CSS design tokens and system preference. */
export function animateElement(element: HTMLElement, keyframes: Keyframe[], durationToken = "--motion-standard") {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (preference.matches) return;
  const styles = getComputedStyle(element);
  const value = styles.getPropertyValue(durationToken).trim();
  const duration = parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  const animation = element.animate(keyframes, { duration, easing: styles.getPropertyValue("--ease-sprout").trim(), fill: "none" });
  const onPreferenceChange = () => { if (preference.matches) animation.finish(); };
  preference.addEventListener("change", onPreferenceChange);
  void animation.finished.finally(() => preference.removeEventListener("change", onPreferenceChange)).catch(() => undefined);
  return animation;
}
