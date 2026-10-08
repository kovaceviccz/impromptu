/** Only follows same-origin paths so login cannot redirect offsite. */
export function safeRedirect(value: FormDataEntryValue | null) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
    ? value
    : "/";
}
