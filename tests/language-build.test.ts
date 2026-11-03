import test from "node:test";
import assert from "node:assert/strict";
import { exactPythonPinAllowed } from "../src/lib/language-build";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
const analyze=(files:Record<string,string>,partial=false)=>{const snapshot:RepositorySnapshot={owner:"fixture",name:"languages",defaultBranch:"main",entries:Object.keys(files).map(path=>({path,type:"blob"})),contents:new Map(Object.entries(files)),sourceFilesFound:0,sourceFilesRead:0,partial};return analyzeSnapshot(snapshot).checks.find(c=>c.id==="build-config")!;};
test("exact Python pins are compared only to fully understood release constraints",()=>{
 assert.equal(exactPythonPinAllowed("3.11.9",">=3.12,<3.14"),false);
 assert.equal(exactPythonPinAllowed("3.13.1",">=3.12,<3.14"),true);
 assert.equal(exactPythonPinAllowed("3.12.1",">=3.12,!=3.12.1"),false);
 assert.equal(exactPythonPinAllowed("3.12.2",">=3.12,!=3.12.1"),true);
 assert.equal(exactPythonPinAllowed("3.12.0","==3.12"),true);
 for(const constraint of ["~=3.12",">=3.12 || <3", "==3.12.*",">=3.12rc1",">=3.12; platform_system=='Linux'"])assert.equal(exactPythonPinAllowed("3.12.1",constraint),undefined);
 for(const pin of ["3.12","system","3.12.1\n3.13.0","3.14.0rc1"])assert.equal(exactPythonPinAllowed(pin,">=3.12"),undefined);
});
test("Python runtime mismatch is review, not a claim about hosting runtime",()=>{
 const bad=analyze({"pyproject.toml":'[project]\nname="app"\nrequires-python=">=3.12"',".python-version":"3.11.9"});
 const finding=bad.findings?.find(f=>f.ruleId==="python-pinned-version");assert.equal(finding?.status,"yellow");assert.equal(finding?.file,".python-version");
 assert.match(finding!.fix,/does not prove the production runtime/);
 const good=analyze({"pyproject.toml":'[project]\nrequires-python=">=3.12"',".python-version":"3.12.9"});assert.equal(good.findings?.some(f=>f.ruleId==="python-pinned-version"),false);
});
test("Go toolchain directives must satisfy the declared module minimum, not an imagined installed version",()=>{
 const bad=analyze({"go.mod":"module example.com/app\ngo 1.24.1\ntoolchain go1.23.4\n"}).findings?.find(f=>f.ruleId==="go-toolchain-minimum");
 assert.equal(bad?.status,"red");assert.equal(bad?.line,3);
 for(const source of ["go 1.24.1\ntoolchain go1.24.1","go 1.24.1\ntoolchain go1.25.0","go 1.24.1\ntoolchain default","go 1.24.1","// go 1.25\ngo 1.24\n// toolchain go1.23.1"])assert.equal(analyze({"go.mod":"module example.com/app\n"+source}).findings?.some(f=>f.ruleId==="go-toolchain-minimum"),false);
});
test("Go local replacements detect deployment-context risks but preserve workspace uncertainty",()=>{
 const source='module example.com/app\ngo 1.24\nreplace example.com/shared => ./packages/shared\n';
 const bad=analyze({"go.mod":source}).findings?.find(f=>f.ruleId==="go-local-replacement");assert.equal(bad?.status,"yellow");assert.equal(bad?.line,3);
 assert.equal(analyze({"go.mod":source,"packages/shared/go.mod":"module example.com/shared"}).findings?.some(f=>f.ruleId==="go-local-replacement"),false);
 assert.equal(analyze({"go.mod":source},true).findings?.some(f=>f.ruleId==="go-local-replacement"),false);
 assert.ok(analyze({"go.mod":'module example.com/app\nreplace (\nexample.com/shared => ../shared\n)'}).findings?.some(f=>f.ruleId==="go-local-replacement"));
 assert.equal(analyze({"go.mod":'module example.com/app\nreplace example.com/shared => example.com/shared v1.2.0\n// replace example.com/shared => ./missing'}).findings?.some(f=>f.ruleId==="go-local-replacement"),false);
});
