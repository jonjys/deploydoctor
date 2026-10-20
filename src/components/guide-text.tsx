import { Fragment } from "react";

/** A command line flag such as --webpack; split keeps the flags at the odd positions. */
const FLAG = /(--[a-z][a-z0-9-]*)/;

/** Guide prose with every CLI flag kept on one line: a browser may otherwise break it after a hyphen on a narrow screen. */
export function GuideText({ text }: { text: string }) {
  return <>{text.split(FLAG).map((part, index) => index % 2 ? <span className="nowrap" key={index}>{part}</span> : <Fragment key={index}>{part}</Fragment>)}</>;
}
