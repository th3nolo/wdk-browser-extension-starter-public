import { act } from "react";

export type TestFormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function pageText(container: HTMLElement): string {
  return container.textContent ?? "";
}

export function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
}

export function fieldByLabel(container: HTMLElement, label: string): TestFormField {
  const labels = [...container.querySelectorAll("label")];
  const match = labels.find((entry) => entry.childNodes[0]?.textContent?.trim() === label);
  const field = match?.querySelector<TestFormField>("input, textarea, select");
  if (!field) throw new Error(`Field not found: ${label}`);
  return field;
}

export function selectOptions(container: HTMLElement, label: string): string[] {
  const field = fieldByLabel(container, label);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Select not found: ${label}`);
  return [...field.options].map((option) => option.value);
}

export async function clickButton(container: HTMLElement, text: string) {
  await act(async () => {
    buttonByText(container, text).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function clickTitle(container: HTMLElement, title: string) {
  await act(async () => {
    const button = [...container.querySelectorAll("button")].find((entry) => entry.title === title);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Button title not found: ${title}`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function setCheckbox(container: HTMLElement, label: string, checked: boolean) {
  await act(async () => {
    const field = [...container.querySelectorAll("label")]
      .find((entry) => entry.textContent?.includes(label))
      ?.querySelector("input");
    if (!(field instanceof HTMLInputElement)) throw new Error(`Checkbox not found: ${label}`);
    if (field.checked !== checked) field.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function setField(container: HTMLElement, label: string, value: string) {
  await act(async () => {
    const field = fieldByLabel(container, label);
    setNativeValue(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export const selectField = setField;

export function setNativeValue(field: TestFormField, value: string) {
  const prototype = Object.getPrototypeOf(field) as TestFormField;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(field, value);
}

export async function waitForText(container: HTMLElement, text: string, timeoutMs = 10_000) {
  await waitFor(() => pageText(container).includes(text), `Timed out waiting for text: ${text}`, timeoutMs);
}

export async function waitForSelector(container: HTMLElement, selector: string, timeoutMs = 10_000) {
  await waitFor(() => Boolean(container.querySelector(selector)), `Timed out waiting for selector: ${selector}`, timeoutMs);
}

export async function waitFor(
  predicate: () => boolean | undefined,
  timeoutMessage = "Timed out waiting for UI update",
  timeoutMs = 10_000
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  throw new Error(timeoutMessage);
}

export function createUiTestHarness(container: HTMLElement) {
  return {
    pageText: () => pageText(container),
    buttonByText: (text: string) => buttonByText(container, text),
    fieldByLabel: (label: string) => fieldByLabel(container, label),
    selectOptions: (label: string) => selectOptions(container, label),
    clickButton: (text: string) => clickButton(container, text),
    clickTitle: (title: string) => clickTitle(container, title),
    setCheckbox: (label: string, checked: boolean) => setCheckbox(container, label, checked),
    setField: (label: string, value: string) => setField(container, label, value),
    selectField: (label: string, value: string) => selectField(container, label, value),
    waitForText: (text: string, timeoutMs?: number) => waitForText(container, text, timeoutMs),
    waitForSelector: (selector: string, timeoutMs?: number) => waitForSelector(container, selector, timeoutMs)
  };
}
