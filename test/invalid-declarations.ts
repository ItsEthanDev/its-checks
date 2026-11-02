export const invalidDeclarations: readonly [string, object, RegExp][] = [
  ["wrong script value", { scripts: { check: false } }, /scripts.*check/s],
  ["replacement without target", { scripts: { lint: { command: "tool ." } } }, /scripts.*lint/s],
  [
    "replacement with blank target",
    { scripts: { lint: { command: "tool .", replaces: " " } } },
    /scripts.*lint/s,
  ],
  [
    "replacement with invalid command",
    { scripts: { lint: { command: false, replaces: "base" } } },
    /scripts.*lint/s,
  ],
  [
    "replacement with unknown field",
    { scripts: { lint: { command: "tool .", replaces: "base", extra: true } } },
    /scripts.*lint/s,
  ],
  [
    "replacement with NUL",
    { scripts: { lint: { command: "tool\u0000", replaces: "base" } } },
    /Script must not contain NUL/,
  ],
  ["reserved helpers", { scripts: { "its-checks:check": "lint" } }, /scripts\.its-checks:check/],
  ["unknown installer field", { installer: "install.js" }, /installer/],
  ["blank names", { name: " " }, /name/],
  ["invalid dependency", { devDependencies: { "bad name": "1" } }, /devDependencies.bad name/],
  [
    "duplicate package section",
    { dependencies: { tool: "1" }, devDependencies: { tool: "1" } },
    /both dependency sections/,
  ],
  ["unsafe migration", { migration: { removeFiles: ["../other"] } }, /migration.removeFiles/],
  ["absolute migration", { migration: { removeFiles: ["/etc/config"] } }, /migration.removeFiles/],
  ["Windows path", { migration: { removeFiles: ["C:\\config"] } }, /migration.removeFiles/],
  ["manifest removal", { migration: { removeFiles: ["package.json"] } }, /package manifest/],
  ["duplicate migration path", { migration: { removeFiles: ["a.json", "A.json"] } }, /Duplicate/],
  [
    "invalid obsolete dependency",
    { migration: { removeDevDependencies: ["bad name"] } },
    /Invalid npm/,
  ],
  [
    "invalid input default",
    {
      inputs: [
        {
          id: "x",
          prompt: "Value?",
          type: "number",
          default: "1",
          destination: { file: ".oxlintrc.json", field: ["rules"] },
        },
      ],
    },
    /default/,
  ],
  [
    "unsafe input path default",
    {
      inputs: [
        {
          id: "x",
          prompt: "Path?",
          type: "path",
          default: "../private",
          destination: { file: ".oxlintrc.json", field: ["rules"] },
        },
      ],
    },
    /default/,
  ],
  [
    "non-JSON input",
    {
      inputs: [
        {
          id: "x",
          prompt: "Value?",
          type: "string",
          destination: { file: ".husky/pre-commit", field: ["x"] },
        },
      ],
    },
    /JSON\/JSONC/,
  ],
  [
    "missing native input file",
    {
      inputs: [
        {
          id: "x",
          prompt: "Value?",
          type: "string",
          destination: { file: "missing.json", field: ["x"] },
        },
      ],
    },
    /destination.file/,
  ],
  [
    "missing native input field",
    {
      inputs: [
        {
          id: "x",
          prompt: "Value?",
          type: "string",
          destination: { file: ".oxlintrc.json", field: ["missing"] },
        },
      ],
    },
    /destination.field/,
  ],
  [
    "prototype input field",
    {
      inputs: [
        {
          id: "x",
          prompt: "Value?",
          type: "string",
          destination: { file: ".oxlintrc.json", field: ["__proto__"] },
        },
      ],
    },
    /prototype/,
  ],
];
