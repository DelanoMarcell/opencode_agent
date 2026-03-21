import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";
import { User } from "@/lib/models/user";

function serializeMatter(matter: {
  _id: { toString(): string };
  code: string;
  title: string;
  description?: string;
  ownerUserId: { toString(): string };
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: matter._id.toString(),
    code: matter.code,
    title: matter.title,
    description: matter.description ?? undefined,
    ownerUserId: matter.ownerUserId.toString(),
    status: matter.status,
    createdAt: matter.createdAt.toISOString(),
    updatedAt: matter.updatedAt.toISOString(),
  };
}

export async function GET() {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const memberships = await MatterMember.find({ userId: user.id }).lean();
  const matterIds = memberships.map((membership) => membership.matterId.toString());
  const matters = await Matter.find({
    _id: { $in: matterIds },
    organisationId: new mongoose.Types.ObjectId(user.organisationId),
  })
    .sort({ updatedAt: -1 })
    .lean();

  return NextResponse.json({
    matters: matters.map(serializeMatter),
  });
}

export async function POST(req: Request) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code, title, description } = await req.json();

    if (!code || !title) {
      return NextResponse.json(
        { error: "Matter code and title are required" },
        { status: 400 }
      );
    }

    await connectDB();

    const matter = await Matter.create({
      organisationId: user.organisationId,
      code: String(code).trim(),
      title: String(title).trim(),
      description: typeof description === "string" ? description.trim() || undefined : undefined,
      ownerUserId: user.id,
    });

    const users = await User.find({
      organisationId: user.organisationId,
    })
      .select({ _id: 1 })
      .lean();

    await MatterMember.insertMany(
      users.map((account) => ({
        matterId: matter._id,
        userId: account._id,
      })),
      { ordered: false }
    );

    return NextResponse.json(
      {
        matter: serializeMatter(matter),
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("duplicate key")
        ? "Matter code already exists"
        : "Failed to create matter";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
