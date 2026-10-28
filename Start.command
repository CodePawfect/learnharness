#!/bin/zsh -l
cd -- "${0:A:h}" || exit 1
npm run local -- --open-browser
