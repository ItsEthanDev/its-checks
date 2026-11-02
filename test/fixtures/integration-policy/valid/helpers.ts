declare function classnames(...classes: string[]): string;
declare function classNames(...classes: string[]): string;
declare function clsx(...classes: string[]): string;
declare function cn(...classes: string[]): string;
declare function ctl(...classes: string[]): string;
declare function cva(...classes: string[]): string;
declare function tv(...classes: string[]): string;
declare function tw(...classes: string[]): string;
declare function twMerge(...classes: string[]): string;
declare function twJoin(...classes: string[]): string;

export const values = [
  classnames("p-4 flex"),
  classNames("p-4 flex"),
  clsx("p-4 flex"),
  cn("p-4 flex"),
  ctl("p-4 flex"),
  cva("p-4 flex"),
  tv("p-4 flex"),
  tw("p-4 flex"),
  twMerge("p-4 flex"),
  twJoin("p-4 flex"),
];

export const customLayout = cn("grid grid-cols-[1fr_2fr]");
