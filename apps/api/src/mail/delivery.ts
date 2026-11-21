import nodemailer from "nodemailer";
import { PRODUCT } from "../contracts.js";

export type Email = { to: string; subject: string; text: string; html: string };
export type MailDelivery = { send(message: Email): Promise<void> };

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}
export function linkEmail(
  to: string,
  subject: string,
  explanation: string,
  url: string,
): Email {
  return {
    to,
    subject,
    text: `${PRODUCT.name}\n\n${explanation}\n\n${url}`,
    html: `<main><h1>${escape(PRODUCT.name)}</h1><p>${escape(explanation)}</p><p><a href="${escape(url)}">${escape(subject)}</a></p></main>`,
  };
}
export function smtpDelivery(host: string, port: number): MailDelivery {
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    socketTimeout: 10000,
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: `${PRODUCT.name} <noreply@${PRODUCT.domain}>`,
        ...message,
      });
    },
  };
}

export class SendingLimits {
  readonly #entries = new Map<string, number[]>();
  allow(key: string, count: number, windowMs: number) {
    const now = Date.now();
    if (this.#entries.size > 10000)
      for (const [id, times] of this.#entries)
        if (!times.some((time) => time > now - 3600000))
          this.#entries.delete(id);
    const entries = (this.#entries.get(key) ?? []).filter(
      (time) => time > now - windowMs,
    );
    if (entries.length >= count) return false;
    this.#entries.set(key, [...entries, now]);
    return true;
  }
}
