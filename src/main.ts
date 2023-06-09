import 'express-async-errors'
import 'dotenv/config'
import express, { Express, NextFunction, Request, Response } from 'express'
import http, { Server } from 'http'
import knex, { Knex } from 'knex'
import Objection from 'objection'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import compression from 'compression'
import zlib from 'zlib'
import CryptoJS from 'crypto-js'

import * as knexfile from 'knexfile'
import { RouteRoles } from '@routes/route.roles'
import { RouteTodos } from '@routes/route.todos'
import { RouteUsers } from '@routes/route.users'
import { size } from '@middlewares/middleware.size'

class App {
  private app: Express
  private server: Server
  private knex: Knex
  private roles: RouteRoles
  private todos: RouteTodos
  private users: RouteUsers

  constructor() {
    this.app = express()
    this.server = http.createServer(this.app)
    this.knex = knex(knexfile[process.env.NODE_ENV])
    this.roles = new RouteRoles()
    this.todos = new RouteTodos()
    this.users = new RouteUsers()
  }

  private connection(): Knex {
    Objection.Model.knex(this.knex)
    return this.knex
  }

  private config(): void {
    this.server.maxHeadersCount = 1048576
    this.server.headersTimeout = 900
    this.server.requestTimeout = 900
    this.server.keepAliveTimeout = 900
    this.app.disabled('x-powered-by')
  }

  private middleware(): void {
    this.app.use(size(1048576))
    this.app.use(express.json())
    this.app.use(express.raw())
    this.app.use(express.urlencoded({ extended: true }))

    this.app.use(helmet())
    this.app.use(
      cors({
        origin: '*',
        methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Timestamp', 'X-Signature', `X-${process.env.NODE_ENV}-Requestid`],
        credentials: true
      })
    )
    this.app.use(
      compression({
        strategy: zlib.constants.Z_RLE,
        level: zlib.constants.Z_BEST_COMPRESSION,
        memLevel: zlib.constants.Z_BEST_COMPRESSION,
        chunkSize: Infinity,
        threshold: Infinity
      })
    )
    this.app.use((req: Request, res: Response, next: NextFunction): void => {
      const requestid: string = CryptoJS.AES.encrypt(process.env.REQUEST_CONTENT, process.env.REQUEST_SECRET_KEY).toString()
      req.headers[`x-${process.env.NODE_ENV}-requestid`] = requestid
      next()
    })
    if (process.env.NODE_ENV !== 'production') {
      this.app.use(morgan('dev'))
    }
  }

  private route(): void {
    this.app.use('/role', this.roles.main())
    this.app.use('/todo', this.todos.main())
    this.app.use('/user', this.users.main())
  }

  private run(): void {
    this.server
      .on('clientError', (err: Error) => {
        if (err) process.stdout.write(`Client error: ${err.message}`)
      })
      .on('error', (err: Error) => {
        if (err) process.stdout.write(`Server error: ${err.message}`)
      })
      .listen(process.env.PORT, () => console.info('Server is running on port: ', process.env.PORT))
  }

  public main(): void {
    this.connection()
    this.config()
    this.middleware()
    this.route()
    this.run()
  }
}

;(function () {
  new App().main()
})()
