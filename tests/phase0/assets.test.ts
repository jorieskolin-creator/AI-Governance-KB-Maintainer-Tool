import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function validator(schemaPath: string) {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  return ajv.compile(read(schemaPath));
}

describe("Phase 0 governed assets", () => {
  const playbook = read("baseline/AI_Governance_Tactic_Playbook_v1.0.0.json");
  const idRegister = read("baseline/id-register.json");

  it("playbook sha256 matches the approved fingerprint", () => {
    const raw = readFileSync("baseline/AI_Governance_Tactic_Playbook_v1.0.0.json");
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "98ba7390ac81351287ec633add49b7349f5bf5989d7fa5a1d259b2a4a4c7486e"
    );
  });

  it("playbook validates against tactic-playbook.schema.json", () => {
    const validate = validator("schemas/tactic-playbook.schema.json");
    expect(validate(playbook), JSON.stringify(validate.errors)).toBe(true);
  });

  it("every tactic id matches the id-register tactic pattern", () => {
    const pattern = new RegExp(idRegister.patterns.tactic);
    for (const t of playbook.tactics) expect(pattern.test(t.id), t.id).toBe(true);
  });

  it("source register validates against source-register.schema.json", () => {
    const validate = validator("schemas/source-register.schema.json");
    const register = read("AI_Governance_Global_Source_Register_v1.5.0.json"); // repo root
    expect(validate(register), JSON.stringify(validate.errors)).toBe(true);
  });
});
