import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { watchKeyboard } from "./native/keyboard";
import { StoreProvider } from "./store";
import "./styles.css";

watchKeyboard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>
);
