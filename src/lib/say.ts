// Sentences the server and shared code show people. They're written in English, with {name}
// placeholders filled in here; the interface matches a filled sentence back to its template to show
// it in the reader's language (translate() in src/i18n). Going through say() is also what lists a
// sentence for translation (scripts/i18n-keys.mjs), so anything a person reads should.

export function say(template: string, vars?: Record<string, string | number>): string {
  return vars ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : template;
}
