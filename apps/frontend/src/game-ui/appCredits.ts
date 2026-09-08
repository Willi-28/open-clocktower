/**
 * App-level attribution shown on the credits screen.
 *
 * This mirrors THIRD-PARTY-NOTICES.md at the repository root - keep the two in
 * step. The Twemoji entry in particular is a CC-BY 4.0 requirement, not a
 * courtesy: the attribution has to reach the people using the app.
 */

export type AppCreditItem = {
  name: string;
  detail: string;
  license: string;
  url?: string;
};

export type AppCreditSection = {
  title: string;
  items: AppCreditItem[];
};

export const unofficialNotice =
  'Open Clocktower is an unofficial fan project. It provides a digital table for storyteller-led social deduction games such as Blood on the Clocktower by The Pandemonium Institute, and is not affiliated with, endorsed by, or sponsored by them.';

export const appLicenseSummary =
  'Open Clocktower is free software under the MIT License. It ships no official game content: no official artwork, logos, rules text, or character packs. Packs bundled with the app are unofficial fan-made content, credited above; storytellers can upload their own to their own server.';

export const aiDisclosure =
  'The bundled artwork (backgrounds, table surfaces, UI frames) was created with AI image generation tools, in some cases starting from reference material. Large parts of the source code were written with AI assistance.';

export const appCreditSections: AppCreditSection[] = [
  {
    title: 'Artwork and fonts',
    items: [
      {
        name: 'Twemoji',
        detail: 'Emoji graphics. Copyright 2020 Twitter, Inc and other contributors.',
        license: 'CC-BY 4.0',
        url: 'https://github.com/jdecked/twemoji',
      },
      {
        name: 'Cinzel',
        detail: 'Display typeface. Copyright 2011 The Cinzel Project Authors.',
        license: 'SIL Open Font License 1.1',
        url: 'https://fonts.google.com/specimen/Cinzel',
      },
      {
        name: 'Pixelify Sans',
        detail: 'Pixel display typeface of the Retro RPG theme. Copyright 2021 The Pixelify Sans Project Authors.',
        license: 'SIL Open Font License 1.1',
        url: 'https://fonts.google.com/specimen/Pixelify+Sans',
      },
      {
        name: 'Alegreya',
        detail: 'Body typeface. Copyright 2011 The Alegreya Project Authors.',
        license: 'SIL Open Font License 1.1',
        url: 'https://fonts.google.com/specimen/Alegreya',
      },
    ],
  },
  {
    title: 'Software',
    items: [
      { name: 'React', detail: 'User interface library. Copyright Meta Platforms, Inc. and affiliates.', license: 'MIT', url: 'https://react.dev' },
      {
        name: 'rnnoise-wasm',
        detail: 'Voice noise suppression by Shiguredo Inc., wrapping RNNoise by Xiph.Org, Mozilla and Jean-Marc Valin.',
        license: 'Apache-2.0 / BSD-3-Clause',
        url: 'https://github.com/shiguredo/rnnoise-wasm',
      },
      { name: 'Electron and Chromium', detail: 'Desktop application runtime, used by the Steam client build.', license: 'MIT / BSD-3-Clause', url: 'https://electronjs.org' },
      { name: 'steamworks.js', detail: 'Steam integration for the desktop build. Copyright (c) 2021 ceifa.', license: 'MIT', url: 'https://github.com/ceifa/steamworks.js' },
      { name: 'FastAPI, Uvicorn, SQLAlchemy, PostgreSQL', detail: 'Server stack of a self-hosted instance.', license: 'MIT / BSD-3-Clause / PostgreSQL', url: 'https://fastapi.tiangolo.com' },
    ],
  },
];
