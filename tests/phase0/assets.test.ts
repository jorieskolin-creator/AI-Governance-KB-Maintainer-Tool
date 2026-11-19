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

  it("the pinned SAE instrument preserves the Thinking Flow questions and refers only to registered sources", () => {
    const { files } = read("baseline/sae-training/input-inventory.json");
    const selected = (role: string) => {
      const entries = files.filter((file: { role: string }) => file.role === role);
      expect(entries, role).toHaveLength(1);
      const entry = entries[0];
      const bytes = readFileSync(entry.path);
      expect(createHash("sha256").update(bytes).digest("hex"), role).toBe(entry.sha256);
      return { entry, text: bytes.toString("utf8") };
    };
    const input = selected("criteria-instrument");
    const instrument = JSON.parse(input.text);
    const register = JSON.parse(selected("source-register").text);
    const registered = new Set(register.sources.map((source: { id: string }) => source.id));
    expect(instrument.version).toBe(input.entry.version);
    expect(instrument.requirements).toHaveLength(30);
    for (const requirement of instrument.requirements) {
      expect(Array.isArray(requirement.sourceIds), requirement.id).toBe(true);
      for (const sourceId of requirement.sourceIds) expect(registered.has(sourceId), `${requirement.id}: ${sourceId}`).toBe(true);
    }
    const questions = [...instrument.controls, ...instrument.antipatterns]
      .flatMap(object => object.questions.map((q: { id: string; question: string }) => [q.id, q.question]));
    const flow = [...selected("cognitive-model").text.matchAll(/<code class="qid">([^<]+)<\/code><div>([^<]+)<\/div>/g)]
      .map(([, id, text]) => [id, text.replaceAll("&#x27;", "'")]);
    expect(questions).toHaveLength(180);
    expect(new Set(questions.map(([id]) => id)).size).toBe(180);
    expect(questions.sort()).toEqual(flow.sort());
  });
});
