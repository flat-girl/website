import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  StackSynthesizer, type ISynthesisSession, type FileAssetSource,
  type FileAssetLocation, type DockerImageAssetSource, type DockerImageAssetLocation,
} from 'aws-cdk-lib'

/** Inline infrastructure only. Website files use the separate local publisher. */
export class StaticSynthesizer extends StackSynthesizer {
  constructor(private readonly executionRoleArn?: string) { super() }

  override get cloudFormationExecutionRole() { return this.executionRoleArn }

  addFileAsset(_asset: FileAssetSource): FileAssetLocation {
    throw new Error('This static site has no CDK file assets. Use make site-publish for publication.')
  }

  addDockerImageAsset(_asset: DockerImageAssetSource): DockerImageAssetLocation {
    throw new Error('This static site has no Docker assets.')
  }

  synthesize(session: ISynthesisSession): void {
    this.synthesizeTemplate(session)
    const file = path.join(session.assembly.outdir, this.boundStack.templateFile)
    // JSON formatting need not consume the inline-template budget. Preserve all values,
    // including the exact Lambda source strings used to determine immutable versions.
    const template = JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))
    if (Buffer.byteLength(template) > 51_200) {
      throw new Error('Template exceeds the CloudFormation inline limit; review asset publishing permissions before expanding it.')
    }
    writeFileSync(file, template)
    this.emitArtifact(session, { cloudFormationExecutionRoleArn: this.executionRoleArn })
  }
}
