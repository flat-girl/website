import { App } from 'aws-cdk-lib'
import { readFileSync } from 'node:fs'
import { config } from '../lib/config.js'
import { Certificates, Images, Site } from '../lib/stacks.js'
import { Access } from '../lib/access.js'
const app=new App()
const project=config(JSON.parse(readFileSync(app.node.tryGetContext('projectConfig') || 'project.json','utf8')))
new Access(app,project)
const certificates=new Certificates(app,project)
new Images(app,project)
new Site(app,project,'beta',certificates.certificate)
new Site(app,project,'production',certificates.certificate)
