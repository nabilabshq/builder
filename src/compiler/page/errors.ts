import type { Component } from "@/types";
import { NabiError } from "@/utils/errors";
import type { HtmlNode } from "@/utils/html";

import { locationFrom } from "./shared";
import type { CompilationState } from "./types";

type SlotError = {
  component: Component;
  message: string;
  state: CompilationState;
};

export const componentError = (message: string, state: CompilationState, node?: HtmlNode) =>
  new NabiError(`Component compilation failed\n\nFile: ${state.page}${locationFrom(node)}\n\n${message}`);

export const slotError = ({ component, message, state }: SlotError) =>
  componentError(`${message}\n\nComponent:\n${component.path}`, state);
