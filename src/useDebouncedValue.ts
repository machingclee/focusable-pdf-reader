import { useEffect, useState } from "react";

/**
 * A value that follows another one after it has been still for `delay` ms.
 *
 * Used for work too expensive to repeat on every tick: re-rendering every page
 * canvas while a pinch is still moving, for instance, would throw away most of
 * the work it starts. The trailing value is the one that lands.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
