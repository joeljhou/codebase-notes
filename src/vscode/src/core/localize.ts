export type MessageArgument = string | number | boolean;

export type Localize = (
  message: string,
  ...args: MessageArgument[]
) => string;

export const defaultLocalize: Localize = (message, ...args) =>
  message.replace(/\{(\d+)\}/gu, (placeholder, rawIndex: string) => {
    const value = args[Number(rawIndex)];
    return value === undefined ? placeholder : String(value);
  });
