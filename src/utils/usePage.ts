import { useState } from "react";

/**
 * The current page of a list. Changing the search or filter (resetKey) goes
 * back to page 1, as in the prototype.
 */
export function usePage(resetKey: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key: resetKey, page: 1 });
  const page = state.key === resetKey ? state.page : 1;
  return [page, (next: number) => setState({ key: resetKey, page: next })];
}
