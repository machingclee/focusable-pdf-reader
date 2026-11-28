/**
 * The app's entry point.
 *
 * What is left here is deliberately nothing: the store is provided in `main.tsx`
 * (one store per webview), the window's tab state, document and geometry live with
 * the viewer window (`components/app/ViewerWindow`), and every piece of chrome
 * draws itself from the store. A new reader can start at `ViewerWindow` for the
 * viewer, or at `store/slices` for what a window knows.
 */
import { ViewerWindow } from "./components/app/ViewerWindow";

export default function App() {
  return <ViewerWindow />;
}
