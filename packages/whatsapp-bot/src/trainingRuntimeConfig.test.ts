import test from "node:test"
import assert from "node:assert/strict"
import { mergeAcceptedAliasesIntoSignals } from "./trainingRuntimeConfig.js"

test("runtime training config merges accepted aliases into family signals", () => {
  const merged = mergeAcceptedAliasesIntoSignals(
    {
      household_paper: ["klopapier"],
    },
    {
      accepted_aliases_by_family: {
        household_paper: ["Toilettenrolle", "WC Papier"],
      },
    },
  )

  assert.ok(merged.household_paper?.includes("klopapier"))
  assert.ok(merged.household_paper?.includes("toilettenrolle"))
  assert.ok(merged.household_paper?.includes("wc papier"))
})
