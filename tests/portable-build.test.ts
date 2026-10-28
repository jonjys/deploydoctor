import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { checkPortableBuild } from "../src/lib/portable-build";
const snapshot = (files: Record<string,string>, partial = false): RepositorySnapshot => ({ owner:"fixture",name:"portable",defaultBranch:"main",contents:new Map(Object.entries(files)),entries:Object.keys(files).map(path=>({path,type:"blob"})),sourceFilesFound:1,sourceFilesRead:1,partial });
test("Rust reads real Cargo evidence without requiring Next.js or package.json",()=>{
 const report=analyzeSnapshot(snapshot({"Cargo.toml":'[package]\nname="shop"\nversion="0.1.0"\nedition="2024"\nrust-version="1.70"\n[[bin]]\nname="shop"\npath="src/Server.rs"',"src/server.rs":"fn main() {}", "rust-toolchain.toml":'[toolchain]\nchannel="1.60.0"'}));
 assert.ok(report.stack?.languages?.includes("Rust"));
 assert.equal(report.checks.some(c=>c.id==="next-entry"),false);
 const build=report.checks.find(c=>c.id==="build-config")!;
 assert.equal(build.status,"red");
 for(const id of ["rust-edition-msrv","rust-toolchain-msrv","rust-target-path"]) assert.ok(build.findings?.some(f=>f.ruleId===id),id);
 assert.ok(build.findings?.every(f=>f.file&&f.line>0&&f.fix));
});
test("valid Rust configuration does not invent compilation success and partial trees do not assert missing targets",()=>{
 const files={"Cargo.toml":'[package]\nname="shop"\nversion="0.1.0"\nedition="2024"\nrust-version="1.85"\n[[bin]]\nname="shop"\npath="src/main.rs"',"src/main.rs":"fn main() {}","rust-toolchain.toml":'[toolchain]\nchannel="stable"'};
 const clean=checkPortableBuild(snapshot(files),"en")!; assert.equal(clean.findings?.length,0);assert.equal(clean.status,"yellow");assert.match(clean.explanation,/not verified/);
 const partial=checkPortableBuild(snapshot({"Cargo.toml":files["Cargo.toml"]},true),"en")!; assert.equal(partial.findings?.some(f=>f.ruleId==="rust-target-path"),false);
});
test("locked Cargo pipelines and malformed TOML have actionable evidence",()=>{
 const result=checkPortableBuild(snapshot({"Cargo.toml":'[package]\nname="shop"\nversion="0.1.0"',".github/workflows/build.yml":"steps:\n  - run: cargo build --locked"}),"en")!;
 assert.equal(result.findings?.[0].ruleId,"rust-locked-build");
 const locked=checkPortableBuild(snapshot({"Cargo.toml":'[package]\nname="shop"',"Cargo.lock":"version = 4","Dockerfile":"RUN cargo build --locked"}),"en")!; assert.equal(locked.findings?.length,0);
 assert.equal(checkPortableBuild(snapshot({"Cargo.toml":"[package"}),"en")?.findings?.[0].ruleId,"invalid-toml");
});
test("Netlify detects an explicit missing npm script and exposed functions directory",()=>{
 const result=checkPortableBuild(snapshot({"package.json":JSON.stringify({scripts:{build:"vite build"}}),"netlify.toml":'[build]\ncommand="npm run production"\npublish="dist"\n[functions]\ndirectory="dist/functions"',"dist/functions/payment.ts":"export default () => null"}),"en")!;
 assert.equal(result.status,"red");for(const id of ["netlify-missing-script","netlify-functions-publish"])assert.ok(result.findings?.some(f=>f.ruleId===id));
 const safe=checkPortableBuild(snapshot({"package.json":JSON.stringify({scripts:{build:"vite build"}}),"netlify.toml":'[build]\ncommand="npm run build"\npublish="dist"\n[functions]\ndirectory="functions"',"functions/payment.ts":"export default () => null"}),"en")!;assert.equal(safe.findings?.length,0);
});
test("Go and Python repositories receive source-aware coverage instead of Next-only results",()=>{
 for(const files of [{"go.mod":"module shop\ngo 1.23","main.go":'package main\nvar url = os.Getenv("PAYMENTS_URL")'}, {"pyproject.toml":'[project]\nname="shop"\nversion="1.0.0"',"main.py":'import os\nurl = os.getenv("PAYMENTS_URL")'}] as Record<string,string>[]){
 const result=analyzeSnapshot(snapshot(files));assert.equal(result.checks.some(c=>c.id==="next-entry"),false);assert.ok(result.stack?.languages?.some(l=>l==="Go"||l==="Python")); assert.ok(result.checks.find(c=>c.id==="env")?.findings?.some(f=>f.problem.includes("PAYMENTS_URL")));
 }
});
