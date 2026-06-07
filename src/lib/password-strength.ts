import { zxcvbn, zxcvbnOptions, type ZxcvbnResult } from "@zxcvbn-ts/core";
import * as zxcvbnCommon from "@zxcvbn-ts/language-common";
import * as zxcvbnEn from "@zxcvbn-ts/language-en";

let initialized = false;

function initZxcvbn() {
  if (initialized) return;
  zxcvbnOptions.setOptions({
    translations: zxcvbnEn.translations,
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: {
      ...zxcvbnCommon.dictionary,
      ...zxcvbnEn.dictionary
    }
  });
  initialized = true;
}

export const MIN_PASSWORD_SCORE = 2;

export const PASSWORD_STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"] as const;

export function analyzePasswordStrength(password: string): ZxcvbnResult {
  initZxcvbn();
  return zxcvbn(password);
}
