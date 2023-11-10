import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyMultipart, { MultipartFile } from "@fastify/multipart";
import { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";

import { FastifySSEPlugin } from "fastify-sse-v2";

import { EventEmitter, on } from "events";
import * as fs from "fs";

import createError from "http-errors";

import { doPhoto, doFfmpeg } from "./ffmpeg";

interface BodyType {
  name: string;
  file: MultipartFile;
  crop: { value: string };
}

const fastify = Fastify({
  // http2: true,
  connectionTimeout: 3000,
  logger: true,
}).withTypeProvider<JsonSchemaToTsProvider>();

// fastify.register(require("@fastify/static"), {
//   root: path.join(__dirname, "public"),
//   prefix: "/public/", // optional: default '/'
// });

fastify.register(cors);
// https://github.com/fastify/fastify-multipart#parse-all-fields-and-assign-them-to-the-body
fastify.register(fastifyMultipart, {
  attachFieldsToBody: true,
  sharedSchemaId: "MultipartFileType",
  limits: {
    fileSize: 10 * 1000 * 1000,
  },
});

fastify.register(FastifySSEPlugin);

fastify.register(import("@fastify/compress"), { global: false });

//
fastify.register(function (fastify, __, done) {
  fastify.get(
    "/op/ffmpeg/video/:folderId/:filename",
    {
      schema: {},
    },
    function (req, res) {
      const { folderId, filename } = req.params;

      res.compress(fs.createReadStream(`tmp/${folderId}/${filename}`));
    },
  );

  done();
});

const target = new EventEmitter();

(async () => {
  for await (const [event] of on(target, "foo")) {
    console.log(
      `${new Date().toISOString()} イベントが発生しました。${JSON.stringify(
        event,
      )}`,
    );
  }
})();

setInterval(() => {
  target.emit("foo", `Tick ${new Date().toISOString()}`);
}, 1000);

fastify.get("/sse", function (req, res) {
  res.sse(
    (async function* () {
      for await (const [event] of on(target, "foo")) {
        yield {
          event: event.name,
          data: JSON.stringify(event),
        };
      }
    })(),
  );
});

fastify.post(
  "/op/ffmpeg/photo",
  {
    schema: {
      description: "Endpoint to update claiming record",
      tags: ["Qr-claims"],
      headers: {
        type: "object",
        properties: {
          "user-agent": { type: "string" },
        },
        required: ["user-agent"],
      },
      body: {
        type: "object",
        // properties: {
        //   'address': {value: { type: 'string' }},
        // },
        required: ["file"],
      },
      response: {
        204: { type: "object" },
      },
      security: [
        {
          authorization: [],
        },
      ],
    },
  },
  async (req, res) => {
    const _file = req.body.file as MultipartFile;
    if (!_file) throw new createError.BadRequest("No file found");
    if (_file.filename.indexOf("/") > 0)
      throw new createError.BadRequest("Bad filename");

    const buffer = await doPhoto(_file);

    res.type("image/webp"); // if you don't set the content, the image would be downloaded by browser instead of viewed
    //@ts-ignore
    res.send(buffer);
  },
);

fastify.post(
  "/op/ffmpeg/video",
  {
    schema: {
      // description: "Endpoint to update claiming record",
      // tags: ["Qr-claims"],
      headers: {
        type: "object",
        properties: {
          "user-agent": { type: "string" },
        },
        required: ["user-agent"],
      },
      body: {
        type: "object",
        // properties: {
        //   'address': { type: 'string' },
        // },
        required: ["crop", "sec", "file"],
      },
      // response: {
      //   204: { type: 'object' },
      // },
      // security: [
      //   {
      //     authorization: [],
      //   },
      // ],
    },
  },
  async (req: FastifyRequest<{ Body: BodyType }>, res) => {
    const _file = req.body.file as MultipartFile;

    target.emit("foo", "Preparing 0");

    if (!_file) throw new createError.BadRequest("No file found");
    if (_file.filename.indexOf("/") > 0)
      throw new createError.BadRequest("Bad filename");

    const folderName = new Date().toISOString();
    fs.mkdirSync(`tmp/${folderName}`);

    doFfmpeg(req, _file, folderName, target);

    return { id: folderName };
  },
);

fastify.get(
  "/op/ffmpeg/video/sharpness/:folderId",
  {
    schema: {},
  },
  function (req, reply) {
    const { folderId } = req.params;
    const content = fs.readFileSync(`tmp/${folderId}/sharpness.json`);
    reply.send(content);
  },
);

// fastify.get(
//   "/shutdown",
//   {
//     schema: {},
//   },
//   function (req, reply) {
//     fs.writeFileSync(
//       "restarted.ts",
//       `console.log("${new Date().toISOString()}")`,
//     );

//     // process.exit();
//     return "bye";
//   },
// );

// Run the server!
fastify.listen({ port: 3000 }, function (err, address) {
  if (err) {
    fastify.log.error(err);
    console.log(err);
    process.exit(1);
  }
  // Server is now listening on ${address}
});
