import { Fragment } from "react";

/**
 * A path or command with a break opportunity after every slash, so a long path wraps there on a narrow screen. The container's
 * overflow-wrap only breaks mid-word when one segment is still wider than the line.
 */
export function Breakable({ text }: { text: string }) {
  return <>{text.split("/").map((part, index) => <Fragment key={index}>{index > 0 && <>/<wbr /></>}{part}</Fragment>)}</>;
}
