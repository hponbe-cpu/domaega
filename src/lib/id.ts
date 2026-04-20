import { randomBytes } from "crypto";

// 9 bytes → 12 base64url chars. ~72 bits of entropy.
export const newAnalysisId = () => randomBytes(9).toString("base64url");
