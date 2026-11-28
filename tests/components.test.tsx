/**
 * The viewer's extracted components, rendered on their own.
 *
 * The refactor that moved them out of `App.tsx` is only safe if the markup they
 * produce is the markup that was there before — the stylesheet is keyed to these
 * class names, and the toolbar's drag region and disabled states are behaviour,
 * not decoration. `App` itself needs a Tauri webview and a backend, so these are
 * the pieces that can be rendered without either.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { PdfToolbar } from "../src/components/toolbar/PdfToolbar";
import { ViewerCommandsProvider, type ViewerCommands } from "../src/components/app/viewerCommands";
import appSlice from "../src/store/slices/appSlice";
import viewerReducer, {
  initialViewerState,
  viewerInitialized,
} from "../src/store/slices/viewerSlice";
import documentReducer, {
  documentOpened,
  recentsRestored,
} from "../src/store/slices/documentSlice";
import panelsReducer from "../src/store/slices/panelsSlice";
import searchReducer from "../src/store/slices/searchSlice";
import { baseApi } from "../src/store/api/baseApi";
import { EmptyDocument } from "../src/components/stage/EmptyDocument";
import { RemarkLayer } from "../src/components/stage/RemarkLayer";
import type { Note } from "../src/types/dto";

/**
 * A store of this file's own, with the app's reducers: the components read their
 * state from it, so a test can set up exactly the state it is about and leave the
 * next one alone.
 */
function testStore() {
  return configureStore({
    reducer: {
      app: appSlice.reducer,
      viewer: viewerReducer,
      document: documentReducer,
      panels: panelsReducer,
      search: searchReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
  });
}

/** The moves the toolbar can ask for; the tests never choose any of them. */
const commands: ViewerCommands = {
  openPicker: () => { },
  openRecent: () => { },
  goToPage: () => { },
  stepScrollHistory: () => { },
  chooseLayout: () => { },
  zoomBy: () => { },
  fitWidth: () => { },
  toggleHighlightPen: () => { },
  toggleNotesPanel: () => { },
  openSearch: () => { },
};

/** The toolbar, as the app mounts it: reading its state from the store. */
function renderToolbar(store = testStore()): string {
  return renderToStaticMarkup(
    <Provider store={store}>
      <ViewerCommandsProvider value={commands}>
        <PdfToolbar />
      </ViewerCommandsProvider>
    </Provider>,
  );
}

describe("PdfToolbar", () => {
  test("the row is the window's second drag surface", () => {
    const html = renderToolbar();
    expect(html).toContain('class="toolbar"');
    expect(html).toContain('data-tauri-drag-region="deep"');
  });

  test("each cluster is a cluster, in the order the row lays them out", () => {
    const html = renderToolbar();
    const clusters = html.split('<div class="toolbar-cluster').length - 1;
    // Open, page readout, scroll history, markup, zoom/find: five clusters.
    expect(clusters).toBe(5);
    expect(html.indexOf("Open PDF")).toBeLessThan(html.indexOf("No document open"));
    expect(html.indexOf("No document open")).toBeLessThan(html.indexOf("Highlight"));
    expect(html.indexOf("Highlight")).toBeLessThan(html.indexOf("Zoom out"));
  });

  test("with no document, the controls that need one are disabled", () => {
    const html = renderToolbar();
    expect(html).toContain("No document open");
    expect(html).toContain(">No recents</option>");
    // The zoom steppers, Fit and the notes toggle all need a page to act on.
    expect(html).toContain('disabled="" aria-label="Zoom out"');
    expect(html).toContain('disabled="" aria-label="Zoom in"');
    expect(html).toContain('<button class="ghost" disabled="">Fit</button>');
    expect(html).toContain('class="ghost notes-toggle" aria-pressed="false" disabled=""');
    // Find is not tied to a document: it opens the box, which then finds nothing.
    expect(html).toContain('<button class="ghost">Find</button>');
  });
});

describe("PdfToolbar with a document", () => {
  test("the readout, the recents and the enabled controls come from the store", () => {
    const store = testStore();
    store.dispatch(documentOpened({ path: "/library/a.pdf", name: "a.pdf", pageCount: 42 }));
    store.dispatch(recentsRestored([{ name: "a.pdf", path: "/library/a.pdf", openedAt: 1 }]));
    store.dispatch(viewerInitialized(initialViewerState({ pageLayout: "single", railOpen: true, stripHeight: 160, stripBlur: 5 })));
    const html = renderToolbar(store);
    expect(html).toContain("/ 42");
    expect(html).toContain("Open recent…");
    expect(html).toContain("42");
    expect(html).not.toContain("No document open");
    // With a document, the controls that need one are live.
    expect(html).not.toContain('disabled="" aria-label="Zoom out"');
  });
});

describe("EmptyDocument", () => {
  const empty = { recents: [], onOpenPicker: () => { }, onOpenRecent: () => { } };

  test("opening says so instead of offering the invitation", () => {
    const html = renderToStaticMarkup(
      <Provider store={testStore()}>
        <EmptyDocument busy {...empty} />
      </Provider>,
    );
    expect(html).toContain("Opening PDF…");
    expect(html).not.toContain("Read one line at a time.");
  });

  test("with nothing open it explains the strip and lists recents", () => {
    const store = testStore();
    store.dispatch(recentsRestored([{ name: "book.pdf", path: "/docs/book.pdf", openedAt: 1 }]));
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <EmptyDocument
          busy={false}
          onOpenPicker={() => { }}
          onOpenRecent={() => { }}
        />
      </Provider>,
    );
    expect(html).toContain("Read one line at a time.");
    expect(html).toContain("Choose a PDF");
    expect(html).toContain("book.pdf");
  });
});

describe("RemarkLayer", () => {
  test("one badge per remarked strip, on its page", () => {
    const strips = [
      { id: 7, page_number: 3, remark: "A passage worth keeping" },
    ] as unknown as Note[];
    const html = renderToStaticMarkup(
      <RemarkLayer
        strips={strips}
        registerNode={() => { }}
        onRemarkClick={() => { }}
        onRemarkDoubleClick={() => { }}
      />,
    );
    expect(html).toContain('class="remark-layer"');
    expect(html).toContain("Page 3 — A passage worth keeping");
    expect(html).toContain('class="remark-marker"');
  });
});

// `NotesColumn` is not rendered here: its panel reaches `pdfjs-dist`'s worker
// URL, which only the Vite bundler resolves, so it cannot be imported under
// `bun test`. Its pathless branch is covered by `PATHLESS_NOTES_MESSAGE`'s own
// tests and its markup is the same as before the extraction.
