import { NextResponse } from "next/server";
import mongoose from "mongoose";

import { getAuthenticatedOrganisationUser } from "@/lib/auth-session";
import { connectDB } from "@/lib/mongodb";
import { Matter } from "@/lib/models/matter";
import { MatterMember } from "@/lib/models/matter-member";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

async function userCanAccessMatter(matterId: string, userId: string, organisationId: string) {
  // A user only has access if the matter exists in their org and they have a membership row for it.
  const [matter, membership] = await Promise.all([
    Matter.findOne({ _id: matterId, organisationId: new mongoose.Types.ObjectId(organisationId) }).lean(),
    MatterMember.findOne({ matterId, userId }).lean(),
  ]);

  if (!matter) {
    return false;
  }

  return Boolean(membership);
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await getAuthenticatedOrganisationUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { code, title, description } = await req.json();

    const trimmedCode = typeof code === "string" ? code.trim() : "";
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedDescription =
      typeof description === "string" ? description.trim() : "";

    if (!trimmedCode || !trimmedTitle) {
      return NextResponse.json(
        { error: "Matter code and title are required" },
        { status: 400 }
      );
    }

    await connectDB();

    // Reject updates to matters outside the current org, even if the raw id exists.
    if (!(await userCanAccessMatter(id, user.id, user.organisationId))) {
      return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    }

    const matter = await Matter.findOneAndUpdate(
      { _id: id, organisationId: new mongoose.Types.ObjectId(user.organisationId) },
      {
        code: trimmedCode.toUpperCase(),
        title: trimmedTitle,
        description: trimmedDescription || undefined,
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).lean();

    if (!matter) {
      return NextResponse.json({ error: "Matter not found" }, { status: 404 });
    }

    return NextResponse.json({
      matter: serializeMatter(matter),
    });
  } catch (error) {
    const duplicateCode =
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: number }).code === 11000
      ) ||
      (error instanceof Error && error.message.includes("duplicate key"));

    return NextResponse.json(
      { error: duplicateCode ? "Matter code already exists" : "Failed to update matter" },
      { status: duplicateCode ? 409 : 500 }
    );
  }
}
