import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
import { FigmaTool } from './core'

class Figma_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Figma'
        this.name = 'figmaTool'
        this.version = 1.0
        this.type = 'Figma'
        this.icon = 'figma.svg'
        this.category = 'Tools'
        this.description = 'Allows agents to retrieve content and comments from a Figma file'
        this.baseClasses = [this.type, 'Tool', ...getBaseClasses(FigmaTool)]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['figmaApi']
        }
        this.inputs = [
            {
                label: 'File Key',
                name: 'fileKey',
                type: 'string',
                placeholder: 'key',
                description:
                    'The file key can be read from any Figma file URL: https://www.figma.com/file/:key/:title. For example, in https://www.figma.com/file/12345/Website, the file key is 12345'
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const fileKey = nodeData.inputs?.fileKey as string

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const accessToken = getCredentialParam('accessToken', credentialData, nodeData)

        return new FigmaTool({ accessToken, fileKey })
    }
}

module.exports = { nodeClass: Figma_Tools }
