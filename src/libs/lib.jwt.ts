import 'dotenv/config'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { Request } from 'express'
import { faker } from '@faker-js/faker'
import { Redis } from '@/libs/lib.redis'
import { session } from '@helpers/helper.session'
import { Encryption } from '@/helpers/helper.encryption'

export interface ISecretMetadata {
  pubKey: string
  privKey: string
  cipherKey: string
}

export interface ISignatureMetadata {
  privKey: crypto.KeyObject
  sigKey: string
  cipherKey: string
}

export class JsonWebToken {
  private jwtToken: string = ''
  private jwtSecretKey: string = ''
  private jwtExpired: number = 600
  private redis: InstanceType<typeof Redis>
  private certMetadata: ISecretMetadata = {
    pubKey: '',
    privKey: '',
    cipherKey: ''
  }
  private sigMetadata: ISignatureMetadata = {
    privKey: {} as any,
    sigKey: '',
    cipherKey: ''
  }

  constructor() {
    this.jwtSecretKey = process.env.JWT_SECRET_KEY!
    this.jwtExpired = +process.env.JWT_EXPIRED!
    this.redis = new Redis(0)
  }

  private async createSecret(prefix: string, expired: number): Promise<ISecretMetadata> {
    const secretKeyExist: number = await this.redis.keyCacheDataExist(`${prefix}secretkey`)

    if (!secretKeyExist) {
      const cipherData: Buffer = await Encryption.AES256Encrypt(this.jwtSecretKey, this.jwtSecretKey)
      const genCertifiate: crypto.KeyPairSyncResult<string, string> = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
          type: 'pkcs1',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem',
          cipher: 'aes-256-cbc',
          passphrase: cipherData.toString('hex')
        }
      })

      this.certMetadata = {
        pubKey: genCertifiate.publicKey,
        privKey: genCertifiate.privateKey,
        cipherKey: cipherData.toString('hex')
      }
      await this.redis.hsetCacheData('jwt', `${prefix}secretkey`, expired, this.certMetadata as any)
    } else {
      this.certMetadata = (await this.redis.hgetCacheData('jwt', `${prefix}secretkey`)) as any
    }

    return this.certMetadata
  }

  private async createSignature(prefix: string, body: any): Promise<ISignatureMetadata> {
    const sigKeyExist: number = await this.redis.keyCacheDataExist(`${prefix}signature`)

    if (!sigKeyExist) {
      const secretKey: ISecretMetadata = await this.createSecret(prefix, this.jwtExpired)
      const rsaPrivateKey: crypto.KeyObject = crypto.createPrivateKey({
        key: Buffer.from(secretKey.privKey),
        type: 'pkcs8',
        format: 'pem',
        passphrase: secretKey.cipherKey
      })

      const bodyPayload: string = JSON.stringify(body)
      const signature: Buffer = crypto.sign('RSA-SHA256', Buffer.from(bodyPayload), rsaPrivateKey)

      const verifiedSignature = crypto.verify('RSA-SHA256', Buffer.from(bodyPayload), secretKey.pubKey, signature)
      if (!verifiedSignature) throw new Error('Credential not verified')

      const signatureOutput: string = signature.toString('hex')
      this.sigMetadata = {
        privKey: rsaPrivateKey,
        sigKey: signatureOutput,
        cipherKey: secretKey.cipherKey
      }
      await this.redis.hsetCacheData('jwt', `${prefix}signature`, this.jwtExpired, this.certMetadata as any)
    } else {
      this.sigMetadata = (await this.redis.hgetCacheData('jwt', `${prefix}signature`)) as any
    }

    return this.sigMetadata
  }

  async sign(req: Request, key: string, body: any): Promise<any> {
    try {
      const sessionExist: boolean = await session(key)
      const tokenExist: number = await this.redis.keyCacheDataExist(`${key}token`)

      const signature: ISignatureMetadata = await this.createSignature(key, body)

      const payload = req.path + '.' + req.method + '.' + signature.sigKey.toLowerCase()
      const symmetricEncrypt: string = Encryption.HMACSHA512Sign(signature.cipherKey, 'hex', payload)

      this.jwtToken = jwt.sign({ key: symmetricEncrypt }, signature.privKey, {
        jwtid: signature.sigKey.substring(0, 32),
        audience: faker.name.firstName().toLowerCase(),
        algorithm: 'RS256',
        expiresIn: this.jwtExpired
      })

      if (sessionExist && !tokenExist) await this.redis.setExCacheData(`${key}token`, this.jwtExpired, this.jwtToken)
      else if (!sessionExist && !tokenExist) throw new Error('Session expired')

      return this.jwtToken
    } catch (e: any) {
      return e.message
    }
  }

  async verify(key: string, token: string): Promise<any> {
    try {
      const secretkey: ISecretMetadata = await this.redis.hgetCacheData('jwt', `${key}secretkey`)
      const signature: ISignatureMetadata = await this.redis.hgetCacheData('jwt', `${key}signature`)

      const verifyToken: jwt.JwtPayload = jwt.verify(token!, secretkey.pubKey) as any
      if (!verifyToken) throw new Error('Invalid signature')
      else if (verifyToken && !Array.isArray(signature.sigKey.match(verifyToken.jti!))) throw new Error('Invalid signature')

      return key
    } catch (e: any) {
      return e.message
    }
  }
}
