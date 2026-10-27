/**
 * Marks <html> with "keyboard-open" while the on-screen keyboard is up.
 *
 * The keyboard shrinks the WebView. On a short screen (landscape) the sticky
 * actions then sit on top of the very field being typed in, so the CSS lets
 * them scroll with the content while this class is set.
 */
export function watchKeyboard() {
  // Tallest height seen per width: the same width means the same orientation.
  const tallest = new Map<number, number>();

  const update = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const full = Math.max(tallest.get(width) ?? 0, height);
    tallest.set(width, full);
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    document.documentElement.classList.toggle("keyboard-open", typing && height < full * 0.8);
  };

  window.addEventListener("resize", update);
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", () => setTimeout(update, 0));
  update();
}
